//! Die eigene Führungsstelle eines Einsatzes (LFH-849): die Gegenstelle des Funkplans (ELW,
//! Einsatzleitung) mit Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und den
//! Fahrzeugen, die sie tragen (LFH-1106), dazu der Einsatzleiter nach FwDV 100 (LFH-1199). Seit
//! LFH-1181 ein Ort mit Ausstattung: Art (mobil, ortsfest), Bezeichnung und Standort (Adresse,
//! Koordinate; `migrations/0179_einsatz_fuehrungsstelle_ort.sql`).
//!
//! Eine Zeile je Einsatz (Migration 0145), lazy beim ersten Schreiben; fehlt sie, gilt die
//! Führungsstelle als nicht erfasst und der Abruf liefert alle Angaben leer. Sprechgruppen (0145)
//! und Fahrzeuge (0171) hängen in eigenen Zuordnungstabellen. Nicht zu verwechseln
//! mit `einsatz_mitgliedschaft.fuehrungsstelle` (Freitext je Person, LFH-461).
//!
//! Herleitung: `openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md` (D2);
//! Einsatzleiter: `openspec/changes/archive/2026-10-11-lfh-1199-einsatzleiter-angabe/design.md` (D1–D3);
//! Ort: `openspec/changes/archive/2026-10-11-lfh-1181-fuehrungsstelle-ort/design.md` (D1, D2).

use crate::error::AppError;
use crate::sprechgruppe::{Sprechgruppe, SprechgruppeAnzeige};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

wire_enum! {
    /// Art der Führungsstelle (FwDV 100): `mobil` (ELW, Führungsfahrzeug) oder `ortsfest`
    /// (Feuerwehrhaus, TEL im Rathaus). Nie leer, Vorgabe `mobil`; die CHECK-Liste in
    /// `migrations/0179_einsatz_fuehrungsstelle_ort.sql` spiegelt `ALLE`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum FuehrungsstellenArt {
        Mobil => "mobil",
        Ortsfest => "ortsfest",
    }
}

/// Höchstlänge der Bezeichnung (LFH-1181, `src/AGENTS.md`, „Eingabegrenzen“).
pub const FUEHRUNGSSTELLE_BEZEICHNUNG_MAX: usize = 200;
/// Höchstlänge der Standort-Adresse, wie der Ort eines Schadens (`schaden::ORT_MAX`).
pub const FUEHRUNGSSTELLE_ADRESSE_MAX: usize = 500;

/// Die Führungsstelle, wie der Client sie liest. Leere Angaben fehlen im JSON; die Art steht
/// immer.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct FuehrungsstelleAnzeige {
    /// Ohne gespeicherte Zeile die Vorgabe `mobil`. Zählt nicht dafür, ob die Führungsstelle
    /// erfasst ist (Spec `einsatz-fuehrungsstelle`).
    pub art: FuehrungsstellenArt,
    /// Name der Stelle, z. B. „ELW 2 Musterstadt“ oder „TEL Rathaus“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezeichnung: Option<String>,
    /// Adresse des Standorts. Wird geschwärzt (kann eine Privatadresse sein).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standort_adresse: Option<String>,
    /// Koordinate des Standorts, nur als Paar gesetzt. Wird mit der Adresse geschwärzt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standort_lat: Option<f64>,
    /// Länge zur Breite `standort_lat`, nur als Paar gesetzt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standort_lon: Option<f64>,
    /// Funkrufname der Führungsstelle, z. B. „Florian Musterstadt 10/1“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rufname: Option<String>,
    /// Zugeordnete Sprechgruppen (Katalog oder einsatzlokal), sortiert wie an Abschnitt und
    /// Einheit.
    pub sprechgruppen: Vec<SprechgruppeAnzeige>,
    /// Kommunikationsart-Schlüssel (`routes::support::KOMMUNIKATIONSMITTEL`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kommunikationsmittel: Option<String>,
    /// Personenbezogen: wird geschwärzt und steht nie im Lagebericht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erreichbarkeit: Option<String>,
    /// Dispositionszeilen (`einsatz_fahrzeug.id`), die die Führungsstelle tragen, aufsteigend.
    /// Nur IDs: die Führungsstelle liest jeder mit dem Einsatz, Fahrzeugdaten nur das Modul
    /// Fahrzeuge (LFH-1106; Spec `einsatz-fuehrungsstelle`, „Fahrzeuge der Führungsstelle“).
    pub fahrzeug_ids: Vec<i64>,
    /// Der Einsatzleiter nach FwDV 100 (LFH-1199); fehlt, solange keiner erfasst ist. Den Namen
    /// liefert der Server jedem, der den Einsatz lesen darf: er ist eingefroren, kein Abruf des
    /// Personals.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatzleiter: Option<EinsatzleiterAnzeige>,
}

wire_enum! {
    /// Woher der Einsatzleiter kommt (LFH-1199). Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum EinsatzleiterArt {
        /// Eine disponierte Person dieses Einsatzes (`einsatz_personal`).
        Personal => "personal",
        /// Ein externer Einsatzleiter als Freitext, etwa der Kreisbrandmeister.
        Extern => "extern",
    }
    try_from = |s| format!("Ungültige Art des Einsatzleiters: {s}");
}

/// Höchstlänge des Freitexts eines externen Einsatzleiters, wie `stab::BEZEICHNUNG_MAX`
/// (`src/AGENTS.md`, „Eingabegrenzen“). Spiegel: `frontend/src/api/eingabegrenzen.ts`.
pub const EINSATZLEITER_NAME_MAX: usize = 200;

/// Der Einsatzleiter, wie der Client ihn liest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinsatzleiterAnzeige {
    pub art: EinsatzleiterArt,
    /// Bei `personal` der beim Setzen eingefrorene Name, bei `extern` der Freitext. Fehlt nur nach
    /// der Schwärzung des Einsatzes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Die Dispositionszeile (`einsatz_personal.id`); fehlt bei `extern` und nach dem Entlassen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personal_id: Option<i64>,
    /// `false`, wenn die Person aus dem Einsatz entlassen ist (Name bleibt, `ON DELETE SET NULL`);
    /// bei `extern` immer `false`.
    pub personal_noch_disponiert: bool,
    /// Seit wann er die Einsatzleitung hat (UTC `YYYY-MM-DD HH:MM:SS`).
    pub seit: String,
}

/// Die vier Spalten des Einsatzleiters an `einsatz_fuehrungsstelle` und ob seine Person noch
/// disponiert ist (`einsatz_personal`-Treffer), so gelesen von der Führungsstelle, vom Einsatzkopf
/// und von der Einsatzliste (LLH-1168). Eine Umformung für alle drei: [`Self::anzeige`].
#[derive(Debug, Clone, Default, sqlx::FromRow)]
pub struct EinsatzleiterSpalten {
    pub einsatzleiter_art: Option<String>,
    pub einsatzleiter_personal_id: Option<i64>,
    pub einsatzleiter_name: Option<String>,
    pub einsatzleiter_seit: Option<String>,
    pub einsatzleiter_noch_disponiert: bool,
}

impl EinsatzleiterSpalten {
    /// Art und seit stehen nur gemeinsam (LFH-1199, D1); eine unbekannte Art kann der CHECK
    /// nicht liefern. Fehlt eins, ist kein Einsatzleiter erfasst.
    pub fn anzeige(self) -> Option<EinsatzleiterAnzeige> {
        let art = self
            .einsatzleiter_art
            .as_deref()
            .and_then(EinsatzleiterArt::parse)?;
        Some(EinsatzleiterAnzeige {
            art,
            name: self.einsatzleiter_name,
            personal_id: self.einsatzleiter_personal_id,
            personal_noch_disponiert: art == EinsatzleiterArt::Personal
                && self.einsatzleiter_noch_disponiert,
            seit: self.einsatzleiter_seit?,
        })
    }
}

/// Höchstzahl der Fahrzeuge einer Führungsstelle (LFH-937, `src/AGENTS.md`, „Eingabegrenzen“).
pub const FAHRZEUGE_JE_FUEHRUNGSSTELLE_MAX: usize = 16;

/// Fahrzeug-Liste von außen: sortiert, entdoppelt, höchstens
/// [`FAHRZEUGE_JE_FUEHRUNGSSTELLE_MAX`] (sonst 400), vor jedem Schreiben.
pub fn normalisiere_fahrzeug_ids(mut ids: Vec<i64>) -> Result<Vec<i64>, AppError> {
    ids.sort_unstable();
    ids.dedup();
    if ids.len() > FAHRZEUGE_JE_FUEHRUNGSSTELLE_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {FAHRZEUGE_JE_FUEHRUNGSSTELLE_MAX} Fahrzeuge je Führungsstelle"
        )));
    }
    Ok(ids)
}

/// Prüft, dass jede ID eine Dispositionszeile dieses Einsatzes ist; sonst 422 (Zusammenhang,
/// `src/AGENTS.md`, Statuscode-Konvention). Eine Abfrage für die ganze Liste.
pub async fn pruefe_fahrzeuge(
    pool: &SqlitePool,
    einsatz_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    let disponiert: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_fahrzeug \
         WHERE id IN (SELECT value FROM json_each(?)) AND einsatz_id = ?",
    )
    .bind(ids_json(ids)?)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    if let Some(id) = ids.iter().find(|id| !disponiert.contains(id)) {
        return Err(AppError::UnprocessableEntity(format!(
            "Fahrzeug {id} ist diesem Einsatz nicht disponiert"
        )));
    }
    Ok(())
}

/// Trägt die Dispositionszeile die Führungsstelle? Wer sie löscht, fragt vorher: die Kaskade
/// (Migration 0171) löst die Zuordnung still, das Ereignis `einsatz` muss der Aufrufer melden.
pub async fn traegt_fahrzeug_tx(
    conn: &mut SqliteConnection,
    einsatz_fahrzeug_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_fuehrungsstelle_fahrzeug WHERE einsatz_fahrzeug_id = ?",
    )
    .bind(einsatz_fahrzeug_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(treffer.is_some())
}

/// Ist die Dispositionszeile der Einsatzleiter? Wer sie löscht, fragt vorher: `ON DELETE SET NULL`
/// (Migration 0177) setzt den Vermerk „nicht mehr disponiert“ still, das Ereignis `einsatz` muss
/// der Aufrufer melden (LLH-1164).
pub async fn is_einsatzleiter_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einsatz_personal_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_fuehrungsstelle \
         WHERE einsatz_id = ? AND einsatzleiter_personal_id = ?",
    )
    .bind(einsatz_id)
    .bind(einsatz_personal_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(treffer.is_some())
}

fn ids_json(ids: &[i64]) -> Result<String, AppError> {
    serde_json::to_string(ids)
        .map_err(|e| AppError::Internal(format!("Fahrzeug-ids serialisieren: {e}")))
}

/// Teiländerung: `None` = unverändert, `Some(None)` = leeren. Werte sind bereits getrimmt und
/// geprüft (Route).
#[derive(Debug, Default)]
pub struct FuehrungsstellePatch<'a> {
    /// Nie leer: die Route lehnt `null` ab.
    pub art: Option<FuehrungsstellenArt>,
    pub bezeichnung: Option<Option<&'a str>>,
    pub standort_adresse: Option<Option<&'a str>>,
    /// Die Route prüft das Paar am Stand nach der Änderung.
    pub standort_lat: Option<Option<f64>>,
    pub standort_lon: Option<Option<f64>>,
    pub rufname: Option<Option<&'a str>>,
    pub kommunikationsmittel: Option<Option<&'a str>>,
    pub erreichbarkeit: Option<Option<&'a str>>,
    /// Ersetzt die Zuordnung vollständig. Die IDs prüft der Aufrufer vorher
    /// (`sprechgruppe::repo::pruefe_zuordenbar`).
    pub sprechgruppe_ids: Option<&'a [i64]>,
    /// Ersetzt die Fahrzeuge vollständig. Die IDs prüft der Aufrufer vorher
    /// ([`pruefe_fahrzeuge`]).
    pub fahrzeug_ids: Option<&'a [i64]>,
    /// Setzt (`Some(Some)`) oder leert (`Some(None)`) den Einsatzleiter; schreibt bei einem
    /// fachlichen Wechsel den Übergabe-Eintrag ins ETB (D3).
    pub einsatzleiter: Option<Option<EinsatzleiterEingabe<'a>>>,
}

/// Ein neuer Einsatzleiter; Name getrimmt und geprüft, `seit` normalisiert (Route).
#[derive(Debug, Clone, Copy)]
pub enum EinsatzleiterEingabe<'a> {
    Personal { personal_id: i64, seit: &'a str },
    Extern { name: &'a str, seit: &'a str },
}

/// Wer den Patch schreibt, für den Übergabe-Eintrag im ETB.
#[derive(Debug, Clone, Copy)]
pub struct Schreiber {
    pub benutzer_id: i64,
    /// `etb_startwert` des Einsatzes, vor der Transaktion geladen (LFH-133).
    pub etb_startwert: i64,
}

#[derive(sqlx::FromRow)]
struct Zeile {
    art: String,
    bezeichnung: Option<String>,
    standort_adresse: Option<String>,
    standort_lat: Option<f64>,
    standort_lon: Option<f64>,
    rufname: Option<String>,
    kommunikationsmittel: Option<String>,
    erreichbarkeit: Option<String>,
    #[sqlx(flatten)]
    einsatzleiter: EinsatzleiterSpalten,
}

/// Lädt die Führungsstelle; ohne Zeile alle Angaben leer.
pub async fn load(pool: &SqlitePool, einsatz_id: i64) -> Result<FuehrungsstelleAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    load_tx(&mut conn, einsatz_id).await
}

async fn load_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<FuehrungsstelleAnzeige, AppError> {
    let zeile = sqlx::query_as::<_, Zeile>(
        "SELECT fs.art, fs.bezeichnung, fs.standort_adresse, fs.standort_lat, fs.standort_lon, \
                fs.rufname, fs.kommunikationsmittel, fs.erreichbarkeit, \
                fs.einsatzleiter_art, fs.einsatzleiter_personal_id, fs.einsatzleiter_name, \
                fs.einsatzleiter_seit, ep.id IS NOT NULL AS einsatzleiter_noch_disponiert \
         FROM einsatz_fuehrungsstelle fs \
         LEFT JOIN einsatz_personal ep ON ep.id = fs.einsatzleiter_personal_id \
         WHERE fs.einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let sprechgruppen = sqlx::query_as::<_, Sprechgruppe>(
        "SELECT sg.id, sg.org_id, sg.einsatz_id, sg.bezeichnung, sg.betriebsart, \
                sg.hinweis, sg.netz, sg.sicherheit, sg.aktiv, sg.sortier, sg.angelegt_at \
         FROM sprechgruppe sg \
         JOIN einsatz_fuehrungsstelle_sprechgruppe fs ON fs.sprechgruppe_id = sg.id \
         WHERE fs.einsatz_id = ? \
         ORDER BY sg.betriebsart, sg.sortier, sg.bezeichnung",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let fahrzeug_ids = sqlx::query_scalar::<_, i64>(
        "SELECT einsatz_fahrzeug_id FROM einsatz_fuehrungsstelle_fahrzeug \
         WHERE einsatz_id = ? ORDER BY einsatz_fahrzeug_id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let Some(z) = zeile else {
        return Ok(FuehrungsstelleAnzeige {
            art: FuehrungsstellenArt::Mobil,
            bezeichnung: None,
            standort_adresse: None,
            standort_lat: None,
            standort_lon: None,
            rufname: None,
            sprechgruppen: sprechgruppen.iter().map(Sprechgruppe::anzeige).collect(),
            kommunikationsmittel: None,
            erreichbarkeit: None,
            fahrzeug_ids,
            einsatzleiter: None,
        });
    };
    let fs_art = FuehrungsstellenArt::parse(&z.art).ok_or_else(|| {
        AppError::Internal(format!("Unbekannte Art der Führungsstelle: {}", z.art))
    })?;
    Ok(FuehrungsstelleAnzeige {
        art: fs_art,
        bezeichnung: z.bezeichnung,
        standort_adresse: z.standort_adresse,
        standort_lat: z.standort_lat,
        standort_lon: z.standort_lon,
        rufname: z.rufname,
        sprechgruppen: sprechgruppen.iter().map(Sprechgruppe::anzeige).collect(),
        kommunikationsmittel: z.kommunikationsmittel,
        erreichbarkeit: z.erreichbarkeit,
        fahrzeug_ids,
        einsatzleiter: z.einsatzleiter.anzeige(),
    })
}

/// Der fachliche Stand des Einsatzleiters: Art, Person, Name. `seit` gehört nicht dazu — eine
/// geänderte Zeit allein ist keine Übergabe (Spec, „Übergabe der Einsatzleitung im ETB“).
type Stand = Option<(EinsatzleiterArt, Option<i64>, Option<String>)>;

async fn einsatzleiter_stand(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Stand, AppError> {
    let row: Option<(Option<String>, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT einsatzleiter_art, einsatzleiter_personal_id, einsatzleiter_name \
         FROM einsatz_fuehrungsstelle WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row
        .and_then(|(art, pid, name)| Some((EinsatzleiterArt::parse(art.as_deref()?)?, pid, name))))
}

/// Der Name, wie ihn Anzeige und ETB-Text führen: extern mit Zusatz „(extern)“.
fn stand_name(stand: &(EinsatzleiterArt, Option<i64>, Option<String>)) -> String {
    let name = stand.2.as_deref().unwrap_or("unbekannt");
    match stand.0 {
        EinsatzleiterArt::Personal => name.to_string(),
        EinsatzleiterArt::Extern => format!("{name} (extern)"),
    }
}

/// Der Wortlaut des Übergabe-Eintrags; `None`, wenn sich fachlich nichts geändert hat.
fn uebergabe_text(vorher: &Stand, nachher: &Stand) -> Option<String> {
    let gleich = match (vorher, nachher) {
        // Eine Person ist dieselbe, wenn die Dispositionszeile gleich ist (der Name ist ihr
        // Abbild); eine entlassene Person (`None`) ist nie dieselbe wie eine neu gewählte.
        (Some((EinsatzleiterArt::Personal, a, _)), Some((EinsatzleiterArt::Personal, b, _))) => {
            a.is_some() && a == b
        }
        (a, b) => a == b,
    };
    if gleich {
        return None;
    }
    Some(match (vorher, nachher) {
        (None, Some(n)) => format!("Einsatzleitung übernommen: {}", stand_name(n)),
        (Some(v), Some(n)) => format!(
            "Übergabe der Einsatzleitung von {} an {}",
            stand_name(v),
            stand_name(n)
        ),
        (Some(v), None) => format!(
            "Einsatzleitung nicht mehr erfasst (vorher: {})",
            stand_name(v)
        ),
        (None, None) => return None,
    })
}

/// Prüft, dass `personal_id` eine Disposition **dieses** Einsatzes ist (sonst 422), und liefert
/// ihren `snap_name` zum Einfrieren — Muster `stab::repo::snap_name_von`.
async fn load_snap_name(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    personal_id: i64,
) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(personal_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    name.ok_or_else(|| {
        AppError::UnprocessableEntity(format!(
            "Person {personal_id} ist in diesem Einsatz nicht disponiert"
        ))
    })
}

/// Schreibt den Einsatzleiter und, bei einem fachlichen Wechsel, den Übergabe-Eintrag ins ETB —
/// in der offenen Transaktion des Aufrufers. Liefert die id des Eintrags.
async fn save_einsatzleiter_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    schreiber: Schreiber,
    eingabe: Option<EinsatzleiterEingabe<'_>>,
) -> Result<Option<i64>, AppError> {
    // Ein abgeschlossener Einsatz bekommt keinen Eintrag mehr: der Extractor prüft vor der
    // Transaktion, ein konkurrierender Abschluss kann dazwischenliegen (D3).
    crate::stab::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;
    let vorher = einsatzleiter_stand(conn, einsatz_id).await?;
    let (nachher, seit): (Stand, Option<&str>) = match eingabe {
        None => (None, None),
        Some(EinsatzleiterEingabe::Personal { personal_id, seit }) => {
            let name = load_snap_name(conn, einsatz_id, personal_id).await?;
            (
                Some((EinsatzleiterArt::Personal, Some(personal_id), Some(name))),
                Some(seit),
            )
        }
        Some(EinsatzleiterEingabe::Extern { name, seit }) => (
            Some((EinsatzleiterArt::Extern, None, Some(name.to_string()))),
            Some(seit),
        ),
    };
    let (art, pid, name) = match &nachher {
        Some((art, pid, name)) => (Some(art.as_str()), *pid, name.as_deref()),
        None => (None, None, None),
    };
    sqlx::query(
        "UPDATE einsatz_fuehrungsstelle SET einsatzleiter_art = ?, \
            einsatzleiter_personal_id = ?, einsatzleiter_name = ?, einsatzleiter_seit = ? \
         WHERE einsatz_id = ?",
    )
    .bind(art)
    .bind(pid)
    .bind(name)
    .bind(seit)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;

    let Some(inhalt) = uebergabe_text(&vorher, &nachher) else {
        return Ok(None);
    };
    let daten = crate::etb::repo::EintragDaten {
        typ: crate::etb::TYP_SYSTEM,
        inhalt: &inhalt,
        von: None,
        an: None,
        meldeweg: None,
        veranlassung: None,
        // Die Übergabe gilt ab „seit“; beim Leeren gilt die Zeit des Speicherns.
        ereigniszeit: seit,
        erfasst_lokal_at: None,
        berichtigt_eintrag_id: None,
    };
    crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        schreiber.benutzer_id,
        schreiber.etb_startwert,
        daten,
    )
    .await
    .map(Some)
}

/// Schreibt die Teiländerung und liefert den neuen Stand — alles in der offenen Transaktion des
/// Aufrufers (`write_retry!`), damit ein Fehler nichts teilweise speichert.
///
/// Liefert dazu die id eines Übergabe-Eintrags im ETB; den Live-Kurzruf macht der Aufrufer nach
/// dem Commit.
pub async fn patch_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    schreiber: Schreiber,
    patch: &FuehrungsstellePatch<'_>,
) -> Result<(FuehrungsstelleAnzeige, Option<i64>), AppError> {
    sqlx::query("INSERT OR IGNORE INTO einsatz_fuehrungsstelle (einsatz_id) VALUES (?)")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    // Je Feld ein UPDATE: feste Statements statt eines zusammengesetzten SQL-Texts.
    if let Some(art) = patch.art {
        sqlx::query("UPDATE einsatz_fuehrungsstelle SET art = ? WHERE einsatz_id = ?")
            .bind(art.as_str())
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
    }
    for (spalte, wert) in [
        ("standort_lat", patch.standort_lat),
        ("standort_lon", patch.standort_lon),
    ] {
        let Some(wert) = wert else { continue };
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE einsatz_fuehrungsstelle SET {spalte} = ? WHERE einsatz_id = ?"
        )))
        .bind(wert)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    }
    for (spalte, wert) in [
        ("bezeichnung", patch.bezeichnung),
        ("standort_adresse", patch.standort_adresse),
        ("rufname", patch.rufname),
        ("kommunikationsmittel", patch.kommunikationsmittel),
        ("erreichbarkeit", patch.erreichbarkeit),
    ] {
        let Some(wert) = wert else { continue };
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE einsatz_fuehrungsstelle SET {spalte} = ? WHERE einsatz_id = ?"
        )))
        .bind(wert)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    }
    if let Some(ids) = patch.sprechgruppe_ids {
        crate::sprechgruppe::repo::ersetzen_tx(
            conn,
            crate::sprechgruppe::repo::Zuordnungsziel::Fuehrungsstelle(einsatz_id),
            ids,
        )
        .await?;
    }
    if let Some(ids) = patch.fahrzeug_ids {
        // Zwei Anweisungen, unabhängig von der Länge der Liste (Muster
        // `sprechgruppe::repo::ersetzen_tx`).
        let ids = ids_json(ids)?;
        sqlx::query(
            "DELETE FROM einsatz_fuehrungsstelle_fahrzeug WHERE einsatz_id = ? \
               AND einsatz_fahrzeug_id NOT IN (SELECT value FROM json_each(?))",
        )
        .bind(einsatz_id)
        .bind(&ids)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO einsatz_fuehrungsstelle_fahrzeug \
               (einsatz_id, einsatz_fahrzeug_id) SELECT ?, value FROM json_each(?)",
        )
        .bind(einsatz_id)
        .bind(&ids)
        .execute(&mut *conn)
        .await?;
    }
    let etb_id = match patch.einsatzleiter {
        Some(eingabe) => save_einsatzleiter_tx(conn, einsatz_id, schreiber, eingabe).await?,
        None => None,
    };
    Ok((load_tx(conn, einsatz_id).await?, etb_id))
}
