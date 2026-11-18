//! Einsatzakte (LLH-1835, `openspec/changes/archive/2026-11-18-hsdhm2ki-einsatzakte/design.md` D6/D7): das ZIP mit
//! allen Anhängen und Tabellen eines Einsatzes. Den lesbaren Teil der Akte druckt der Browser
//! (`frontend/src/druck/einsatzakte/`); hier entsteht nur, was sich nicht drucken lässt.
//!
//! Ablauf im Handler (`routes::einsatzakte`): Gate über [`AKTE_MODULE`] → [`sammeln`] →
//! Protokoll → [`ZipBau`] in eine Temp-Datei → Streaming.

use crate::einsatz::schwaerzung_nachlauf::zur_entfernung_vorgesehen_sql;
use crate::error::AppError;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::io::{Seek, Write};
use std::sync::{Arc, Mutex};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// Die Module, aus denen die Einsatzakte schöpft — Druck UND ZIP. Wer eines davon nicht lesen
/// darf, bekommt keine Akte (Spec `einsatzakte`, „Vollständig oder gar nicht“); ein im Einsatz
/// ausgeblendetes sperrt nicht. Gespiegelt in `frontend/src/druck/einsatzakte/quellen.ts`
/// (`AKTE_MODULE`); der Test `akte_module_wie_im_client` vergleicht beide.
pub const AKTE_MODULE: &[&str] = &[
    // Einsatzbericht in vollem Umfang (`frontend/src/druck/einsatzbericht/quellen.ts`).
    "lagebesprechung",
    "einheiten",
    "personal",
    "fahrzeuge",
    "lageberichte",
    "personen",
    "schaeden",
    "evakuierung",
    "betreuung",
    "verpflegung",
    "etb",
    "material",
    // Kapitel Aufträge und Einsatzbefehle.
    "auftraege",
    // Nur im ZIP: Anhänge und Tabellen.
    "dokumente",
    "tiere",
    "unfallhilfsstellen",
];

/// Woher eine Datei im ZIP stammt; bestimmt Ordner, Modul-Key und Protokoll.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Herkunft {
    Etb,
    Dokumentenablage,
    Betroffene,
    Schaeden,
    Tiere,
    Unfallhilfsstellen,
    Einsatzbefehle,
    Lageberichte,
}

impl Herkunft {
    /// Reihenfolge im ZIP und im Inhaltsverzeichnis.
    pub const ALLE: [Herkunft; 8] = [
        Herkunft::Etb,
        Herkunft::Dokumentenablage,
        Herkunft::Betroffene,
        Herkunft::Schaeden,
        Herkunft::Tiere,
        Herkunft::Unfallhilfsstellen,
        Herkunft::Einsatzbefehle,
        Herkunft::Lageberichte,
    ];

    /// Der Modul-Key des Lese-Gates.
    pub fn modul(self) -> &'static str {
        match self {
            Herkunft::Etb => "etb",
            Herkunft::Dokumentenablage => "dokumente",
            Herkunft::Betroffene => "personen",
            Herkunft::Schaeden => "schaeden",
            Herkunft::Tiere => "tiere",
            Herkunft::Unfallhilfsstellen => "unfallhilfsstellen",
            Herkunft::Einsatzbefehle => "auftraege",
            Herkunft::Lageberichte => "lageberichte",
        }
    }

    /// Ordner im ZIP und Spalte „Modul“ des Inhaltsverzeichnisses.
    pub fn ordner(self) -> &'static str {
        match self {
            Herkunft::Etb => "ETB",
            Herkunft::Dokumentenablage => "Dokumentenablage",
            Herkunft::Betroffene => "Betroffene",
            Herkunft::Schaeden => "Schaeden",
            Herkunft::Tiere => "Tiere",
            Herkunft::Unfallhilfsstellen => "Unfallhilfsstellen",
            Herkunft::Einsatzbefehle => "Einsatzbefehle",
            Herkunft::Lageberichte => "Lageberichte",
        }
    }

    fn aus_sql(s: &str) -> Option<Herkunft> {
        Herkunft::ALLE.into_iter().find(|h| h.ordner() == s)
    }
}

/// Ein Anhang, der ins ZIP gehört (noch ohne Bytes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AkteDatei {
    pub herkunft: Herkunft,
    pub anhang_id: i64,
    /// Kennung des Linkers (`uhs_anhang.id` usw.): das UHS-Protokoll nennt sie.
    pub linker_id: i64,
    /// Datensatz in Worten: „Nr. 12“, „R-003“, „UHS BHP 50“, Titel eines Dokuments.
    pub datensatz: String,
    /// Kennung des Datensatzes: zwei Datensätze mit gleichem Namen bekommen getrennte Ordner.
    pub besitzer_id: i64,
    /// Betroffene Person (Personen-Protokoll).
    pub person_id: Option<i64>,
    pub dateiname: String,
    pub mime: String,
    /// Pfad im ZIP, eindeutig ([`vergib_pfade`]).
    pub pfad: String,
}

#[derive(sqlx::FromRow)]
struct Zeile {
    herkunft: String,
    anhang_id: i64,
    linker_id: i64,
    datensatz: String,
    besitzer_id: i64,
    person_id: Option<i64>,
    dateiname: String,
    mime: String,
}

/// Alle Anhänge des Einsatzes, die ins ZIP gehören, in der Reihenfolge von [`Herkunft::ALLE`],
/// darin nach Datensatz und Ablage: ohne gelöschte und stornierte Datensätze, ohne Chat, von
/// Befehlen und Lageberichten nur der jüngste freigegebene Stand, ohne zur Entfernung
/// vorgesehene (Schwärzung). `aufnehmen` entscheidet je Herkunft (im Einsatz ausgeblendetes
/// Modul → nein).
pub async fn sammeln(
    pool: &SqlitePool,
    einsatz_id: i64,
    aufnehmen: impl Fn(Herkunft) -> bool,
) -> Result<Vec<AkteDatei>, AppError> {
    // Der jüngste freigegebene Stand: freigegeben und von keinem freigegebenen fortgeschrieben.
    let aktuell = |t: &str| {
        format!(
            "d.status = 'freigegeben' AND NOT EXISTS (SELECT 1 FROM {t} n \
             WHERE n.vorgaenger_id = d.id AND n.status = 'freigegeben')"
        )
    };
    let sql = format!(
        "SELECT * FROM ( \
         SELECT 'ETB' AS herkunft, a.id AS anhang_id, e.id AS linker_id, \
                'Nr. ' || e.lfd_nr AS datensatz, e.id AS besitzer_id, NULL AS person_id, a.dateiname, \
                a.mime, 1 AS rang, e.lfd_nr AS sortierung \
           FROM etb_eintrag_anhang l JOIN etb_eintrag e ON e.id = l.eintrag_id \
           JOIN anhang a ON a.id = l.anhang_id WHERE e.einsatz_id = ?1 \
         UNION ALL \
         SELECT 'Dokumentenablage', a.id, l.id, l.titel, l.id, NULL, a.dateiname, a.mime, 2, l.id \
           FROM einsatz_dokument l JOIN anhang a ON a.id = l.anhang_id \
          WHERE l.einsatz_id = ?1 AND l.geloescht_at IS NULL \
         UNION ALL \
         SELECT 'Betroffene', a.id, l.id, printf('R-%03d', p.registrier_nr), p.id, p.id, a.dateiname, \
                a.mime, 3, p.registrier_nr \
           FROM einsatz_person_anhang l JOIN einsatz_person p ON p.id = l.person_id \
           JOIN anhang a ON a.id = l.anhang_id \
          WHERE l.einsatz_id = ?1 AND l.geloescht_at IS NULL AND p.storniert_at IS NULL \
         UNION ALL \
         SELECT 'Schaeden', a.id, l.id, printf('S-%03d', s.registrier_nr), s.id, NULL, a.dateiname, \
                a.mime, 4, s.registrier_nr \
           FROM einsatz_schaden_anhang l JOIN einsatz_schaden s ON s.id = l.schaden_id \
           JOIN anhang a ON a.id = l.anhang_id \
          WHERE l.einsatz_id = ?1 AND l.geloescht_at IS NULL AND s.storniert_at IS NULL \
         UNION ALL \
         SELECT 'Tiere', a.id, l.id, printf('T-%03d', t.registrier_nr), t.id, NULL, a.dateiname, \
                a.mime, 5, t.registrier_nr \
           FROM einsatz_tier_anhang l JOIN einsatz_tier t ON t.id = l.tier_id \
           JOIN anhang a ON a.id = l.anhang_id \
          WHERE l.einsatz_id = ?1 AND l.geloescht_at IS NULL AND t.storniert_at IS NULL \
         UNION ALL \
         SELECT 'Unfallhilfsstellen', a.id, l.id, 'UHS ' || u.bezeichnung, u.id, NULL, a.dateiname, \
                a.mime, 6, u.id \
           FROM uhs_anhang l JOIN uhs u ON u.id = l.uhs_id JOIN anhang a ON a.id = l.anhang_id \
          WHERE l.einsatz_id = ?1 AND l.geloescht_at IS NULL AND u.storniert_at IS NULL \
         UNION ALL \
         SELECT 'Einsatzbefehle', a.id, l.id, d.titel || ' (Version ' || d.version || ')', d.id, NULL, \
                a.dateiname, a.mime, 7, d.id \
           FROM befehl_anlage l JOIN befehl d ON d.id = l.befehl_id \
           JOIN anhang a ON a.id = l.anhang_id WHERE l.einsatz_id = ?1 AND {befehl} \
         UNION ALL \
         SELECT 'Lageberichte', a.id, l.id, d.titel || ' (Version ' || d.version || ')', d.id, NULL, \
                a.dateiname, a.mime, 8, d.id \
           FROM lagebericht_anlage l JOIN lagebericht d ON d.id = l.lagebericht_id \
           JOIN anhang a ON a.id = l.anhang_id WHERE l.einsatz_id = ?1 AND {lagebericht} \
         ) x WHERE NOT EXISTS (SELECT 1 FROM anhang a WHERE a.id = x.anhang_id AND {entfernt}) \
         ORDER BY rang, sortierung, anhang_id",
        befehl = aktuell("befehl"),
        lagebericht = aktuell("lagebericht"),
        entfernt = zur_entfernung_vorgesehen_sql("a"),
    );
    let zeilen = sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(sql))
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
    let mut dateien: Vec<AkteDatei> = zeilen
        .into_iter()
        .filter_map(|z| {
            let herkunft = Herkunft::aus_sql(&z.herkunft)?;
            aufnehmen(herkunft).then(|| AkteDatei {
                herkunft,
                anhang_id: z.anhang_id,
                linker_id: z.linker_id,
                datensatz: z.datensatz,
                besitzer_id: z.besitzer_id,
                person_id: z.person_id,
                dateiname: z.dateiname,
                mime: z.mime,
                pfad: String::new(),
            })
        })
        .collect();
    vergib_pfade(&mut dateien);
    Ok(dateien)
}

/// Höchstlänge eines Pfadteils (Zeichen): Windows-Explorer und manche Entpacker scheitern an
/// langen Pfaden.
const MAX_TEIL: usize = 80;

/// Ein Pfadteil ohne Trenner, Steuerzeichen und für Windows verbotene Zeichen, ohne führende
/// oder schließende Punkte und Leerzeichen (kein `..`, kein verstecktes Element), höchstens
/// [`MAX_TEIL`] Zeichen. Leer → `ersatz`.
pub fn sicherer_teil(roh: &str, ersatz: &str) -> String {
    let ersetzt: String = roh
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let getrimmt = ersetzt.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if getrimmt.is_empty() {
        return ersatz.to_string();
    }
    if getrimmt.chars().count() <= MAX_TEIL {
        return getrimmt.to_string();
    }
    // Die Endung behalten, vorn kürzen.
    let (stamm, endung) = stamm_und_endung(getrimmt);
    let platz = MAX_TEIL.saturating_sub(endung.chars().count());
    let gekuerzt: String = stamm.chars().take(platz).collect();
    format!("{}{endung}", gekuerzt.trim_end())
}

/// `("bild", ".jpg")`; ohne Endung `(name, "")`. Eine Endung ist kurz und ohne Leerzeichen.
fn stamm_und_endung(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 && name.len() - i <= 10 && !name[i..].contains(' ') => {
            (&name[..i], &name[i..])
        }
        _ => (name, ""),
    }
}

/// Vergibt jedem Anhang seinen Pfad `<Ordner>/<Datensatz>/<Dateiname>` (die Dokumentenablage
/// ohne Datensatz-Ordner). Zwei Datensätze, deren Namen gleich ausfallen (gleicher Titel, nach dem
/// Bereinigen gleicher Name), bekommen getrennte Ordner mit „ (2)“; gleiche Dateinamen in einem
/// Ordner, auch nur in Groß-/Kleinschreibung verschieden, „ (2)“, „ (3)“ … vor der Endung.
pub fn vergib_pfade(dateien: &mut [AkteDatei]) {
    let mut ordner_von: HashMap<(Herkunft, i64), String> = HashMap::new();
    let mut ordner_belegt: HashSet<String> = HashSet::new();
    let mut belegt: HashSet<String> = HashSet::new();
    for d in dateien.iter_mut() {
        let ordner = match d.herkunft {
            Herkunft::Dokumentenablage => d.herkunft.ordner().to_string(),
            _ => ordner_von
                .entry((d.herkunft, d.besitzer_id))
                .or_insert_with(|| {
                    let basis = format!(
                        "{}/{}",
                        d.herkunft.ordner(),
                        sicherer_teil(&d.datensatz, "ohne Bezeichnung")
                    );
                    let mut ordner = basis.clone();
                    let mut n = 2;
                    while !ordner_belegt.insert(ordner.to_lowercase()) {
                        ordner = format!("{basis} ({n})");
                        n += 1;
                    }
                    ordner
                })
                .clone(),
        };
        let name = sicherer_teil(&d.dateiname, "datei");
        let mut pfad = format!("{ordner}/{name}");
        let (stamm, endung) = stamm_und_endung(&name);
        let mut n = 2;
        while !belegt.insert(pfad.to_lowercase()) {
            pfad = format!("{ordner}/{stamm} ({n}){endung}");
            n += 1;
        }
        d.pfad = pfad;
    }
}

/// Ein Feld des Inhaltsverzeichnisses: wie die Exporte gequotet und gegen Formel-Injektion
/// entschärft.
fn csv_feld(s: &str) -> String {
    let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    };
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Pfad des Inhaltsverzeichnisses im ZIP.
pub const INHALT_PFAD: &str = "inhalt.csv";

/// Kopfzeile des Inhaltsverzeichnisses.
const INHALT_KOPF: &str = "pfad;modul;datensatz;dateiname;groesse;sha256;enthalten\n";

/// Schreibt das ZIP: Tabellen und Anhänge als einzelne Dateien, zuletzt das
/// Inhaltsverzeichnis. Anhänge `Stored` (Bilder und PDFs sind schon komprimiert), Text
/// `Deflated`. Synchron: der Aufrufer schreibt aus `spawn_blocking`.
pub struct ZipBau<W: Write + Seek> {
    zip: ZipWriter<W>,
    inhalt: String,
}

impl<W: Write + Seek> ZipBau<W> {
    pub fn neu(ziel: W) -> Self {
        Self {
            zip: ZipWriter::new(ziel),
            inhalt: String::from(INHALT_KOPF),
        }
    }

    fn schreibe(
        &mut self,
        pfad: &str,
        daten: &[u8],
        methode: CompressionMethod,
    ) -> Result<(), AppError> {
        let optionen = SimpleFileOptions::default()
            .compression_method(methode)
            .large_file(daten.len() as u64 >= u32::MAX as u64)
            .unix_permissions(0o644);
        self.zip
            .start_file(pfad, optionen)
            .map_err(|e| AppError::Internal(format!("ZIP-Eintrag {pfad}: {e}")))?;
        self.zip
            .write_all(daten)
            .map_err(|e| AppError::Internal(format!("ZIP schreiben: {e}")))
    }

    /// Eine Tabelle (CSV) unter `Tabellen/<name>`; steht im Inhaltsverzeichnis.
    pub fn tabelle(&mut self, name: &str, modul: &str, csv: &str) -> Result<(), AppError> {
        let pfad = format!("Tabellen/{name}");
        self.schreibe(&pfad, csv.as_bytes(), CompressionMethod::Deflated)?;
        self.verzeichne(&pfad, modul, "", name, Some(csv.as_bytes()), "ja");
        Ok(())
    }

    /// Ein Anhang mit den ausgelieferten (bereinigten) Bytes.
    pub fn anhang(&mut self, datei: &AkteDatei, daten: &[u8]) -> Result<(), AppError> {
        self.schreibe(&datei.pfad, daten, CompressionMethod::Stored)?;
        self.verzeichne(
            &datei.pfad,
            datei.herkunft.ordner(),
            &datei.datensatz,
            &datei.dateiname,
            Some(daten),
            "ja",
        );
        Ok(())
    }

    /// Ein Anhang, der nicht ins ZIP kommt, mit Grund im Inhaltsverzeichnis.
    pub fn nicht_enthalten(&mut self, datei: &AkteDatei, grund: &str) {
        self.verzeichne(
            &datei.pfad,
            datei.herkunft.ordner(),
            &datei.datensatz,
            &datei.dateiname,
            None,
            &format!("nein: {grund}"),
        );
    }

    fn verzeichne(
        &mut self,
        pfad: &str,
        modul: &str,
        datensatz: &str,
        dateiname: &str,
        daten: Option<&[u8]>,
        enthalten: &str,
    ) {
        let (groesse, sha) = match daten {
            Some(d) => (d.len().to_string(), hex(&Sha256::digest(d))),
            None => (String::new(), String::new()),
        };
        self.inhalt.push_str(&format!(
            "{};{};{};{};{};{};{}\n",
            csv_feld(pfad),
            csv_feld(modul),
            csv_feld(datensatz),
            csv_feld(dateiname),
            groesse,
            sha,
            csv_feld(enthalten),
        ));
    }

    /// Schreibt das Inhaltsverzeichnis und schließt das ZIP.
    pub fn abschliessen(mut self) -> Result<W, AppError> {
        let inhalt = std::mem::take(&mut self.inhalt);
        self.schreibe(INHALT_PFAD, inhalt.as_bytes(), CompressionMethod::Deflated)?;
        self.zip
            .finish()
            .map_err(|e| AppError::Internal(format!("ZIP abschließen: {e}")))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Ein ZIP-Bau je Einsatz zugleich (design.md D7): ein Doppelklick baut nicht zweimal. Dazu
/// höchstens [`MAX_BAUTEN`] auf dem ganzen Server: jeder Bau legt eine volle Kopie aller Anhänge
/// neben die Datenbank, und eine volle Platte ließe auch das Schreiben im Einsatz scheitern. Im
/// `AppState`, nicht prozessweit, damit parallele Tests mit gleicher Einsatz-id sich nicht
/// sperren.
#[derive(Clone, Default)]
pub struct BauSperre(Arc<Mutex<HashSet<i64>>>);

/// Höchstzahl gleichzeitiger ZIP-Bauten auf dem Server.
pub const MAX_BAUTEN: usize = 2;

/// Meldung des 409, wenn für den Einsatz schon ein ZIP entsteht.
pub const BAU_LAEUFT_MELDUNG: &str = "ZIP wird bereits erstellt";

/// Meldung des 503, wenn schon [`MAX_BAUTEN`] ZIPs entstehen.
pub const ZU_VIELE_BAUTEN_MELDUNG: &str =
    "Es werden gerade andere Einsatzakten erstellt. Bitte gleich noch einmal versuchen.";

impl BauSperre {
    /// Belegt den Platz des Einsatzes oder meldet 409 (derselbe Einsatz) bzw. 503 (Server voll).
    /// Frei wird er mit dem [`BauPlatz`].
    pub fn belegen(&self, einsatz_id: i64) -> Result<BauPlatz, AppError> {
        let mut laufend = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if laufend.contains(&einsatz_id) {
            return Err(AppError::Conflict(BAU_LAEUFT_MELDUNG.into()));
        }
        if laufend.len() >= MAX_BAUTEN {
            return Err(AppError::ServiceUnavailable(ZU_VIELE_BAUTEN_MELDUNG.into()));
        }
        laufend.insert(einsatz_id);
        Ok(BauPlatz {
            einsatz_id,
            sperre: self.0.clone(),
        })
    }
}

/// Ein belegter Bauplatz; gibt beim Fallen frei, auch wenn der Download abbricht.
pub struct BauPlatz {
    einsatz_id: i64,
    sperre: Arc<Mutex<HashSet<i64>>>,
}

impl Drop for BauPlatz {
    fn drop(&mut self) {
        self.sperre
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.einsatz_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read};

    fn datei(herkunft: Herkunft, datensatz: &str, name: &str) -> AkteDatei {
        AkteDatei {
            herkunft,
            anhang_id: 1,
            linker_id: 1,
            datensatz: datensatz.into(),
            besitzer_id: 1,
            person_id: None,
            dateiname: name.into(),
            mime: "image/jpeg".into(),
            pfad: String::new(),
        }
    }

    #[test]
    fn sicherer_teil_entfernt_trenner_und_punkte() {
        assert_eq!(sicherer_teil("../../etc/passwd", "x"), "_.._etc_passwd");
        assert_eq!(sicherer_teil("a\\b:c", "x"), "a_b_c");
        assert_eq!(sicherer_teil(" .. ", "datei"), "datei");
        assert_eq!(sicherer_teil("zeile\nzwei", "x"), "zeile_zwei");
        assert_eq!(sicherer_teil(".versteckt", "x"), "versteckt");
    }

    #[test]
    fn sicherer_teil_kuerzt_und_behaelt_die_endung() {
        let lang = format!("{}.jpg", "a".repeat(200));
        let kurz = sicherer_teil(&lang, "x");
        assert_eq!(kurz.chars().count(), MAX_TEIL);
        assert!(kurz.ends_with(".jpg"));
    }

    #[test]
    fn pfade_sind_eindeutig_auch_ohne_gross_klein_und_je_datensatz() {
        let mut d = vec![
            datei(Herkunft::Etb, "Nr. 3", "lage.jpg"),
            datei(Herkunft::Etb, "Nr. 3", "lage.jpg"),
            datei(Herkunft::Etb, "Nr. 3", "LAGE.jpg"),
            datei(Herkunft::Dokumentenablage, "Plan", "plan.pdf"),
            datei(Herkunft::Unfallhilfsstellen, "UHS BHP/50", "x.png"),
            AkteDatei {
                besitzer_id: 2,
                ..datei(Herkunft::Unfallhilfsstellen, "UHS BHP_50", "x.png")
            },
        ];
        vergib_pfade(&mut d);
        let pfade: Vec<&str> = d.iter().map(|d| d.pfad.as_str()).collect();
        assert_eq!(
            pfade,
            vec![
                "ETB/Nr. 3/lage.jpg",
                "ETB/Nr. 3/lage (2).jpg",
                "ETB/Nr. 3/LAGE (3).jpg",
                "Dokumentenablage/plan.pdf",
                "Unfallhilfsstellen/UHS BHP_50/x.png",
                "Unfallhilfsstellen/UHS BHP_50 (2)/x.png",
            ]
        );
    }

    #[test]
    fn zip_enthaelt_tabellen_anhaenge_und_inhaltsverzeichnis() {
        let mut a = datei(Herkunft::Etb, "Nr. 1", "foto.jpg");
        let mut b = datei(Herkunft::Schaeden, "S-002", "kaputt.png");
        vergib_pfade(std::slice::from_mut(&mut a));
        b.pfad = "Schaeden/S-002/kaputt.png".into();

        let mut bau = ZipBau::neu(Cursor::new(Vec::new()));
        bau.tabelle("betroffene.csv", "personen", "kopf\n=1\n")
            .unwrap();
        bau.anhang(&a, b"JPEGDATEN").unwrap();
        bau.nicht_enthalten(&b, "lässt sich nicht bereinigen");
        let bytes = bau.abschliessen().unwrap().into_inner();

        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let namen: Vec<String> = (0..zip.len())
            .map(|i| zip.by_index(i).unwrap().name().unwrap().to_string())
            .collect();
        assert_eq!(
            namen,
            vec!["Tabellen/betroffene.csv", "ETB/Nr. 1/foto.jpg", INHALT_PFAD]
        );
        let mut foto = Vec::new();
        zip.by_name("ETB/Nr. 1/foto.jpg")
            .unwrap()
            .read_to_end(&mut foto)
            .unwrap();
        assert_eq!(foto, b"JPEGDATEN");

        let mut inhalt = String::new();
        zip.by_name(INHALT_PFAD)
            .unwrap()
            .read_to_string(&mut inhalt)
            .unwrap();
        let sha = hex(&Sha256::digest(b"JPEGDATEN"));
        assert!(inhalt.starts_with(INHALT_KOPF));
        assert!(inhalt.contains(&format!(
            "\"ETB/Nr. 1/foto.jpg\";\"ETB\";\"Nr. 1\";\"foto.jpg\";9;{sha};\"ja\""
        )));
        assert!(inhalt.contains(
            "\"Schaeden/S-002/kaputt.png\";\"Schaeden\";\"S-002\";\"kaputt.png\";;;\"nein: lässt sich nicht bereinigen\""
        ));
    }

    #[test]
    fn bausperre_haelt_je_einsatz_und_gibt_beim_fallen_frei() {
        let sperre = BauSperre::default();
        let platz = sperre.belegen(7).unwrap();
        assert!(matches!(sperre.belegen(7), Err(AppError::Conflict(_))));
        let anderer = sperre.belegen(8).unwrap();
        assert!(matches!(
            sperre.belegen(9),
            Err(AppError::ServiceUnavailable(_))
        ));
        drop(platz);
        assert!(sperre.belegen(7).is_ok());
        drop(anderer);
    }
}
