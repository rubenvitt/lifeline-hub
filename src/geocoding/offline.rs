//! Adresssuche ohne Internet aus den Offline-Karten (LLH-1119, Spec `lagekarte-ortssuche`,
//! „Adresssuche aus der Offline-Karte“). Jede Region bringt einen Adressindex mit
//! (`*.adressen.sqlite` im Kartenverzeichnis, gebaut vom karten-service, Format in
//! `karten_katalog::adressindex`). Herleitung: `/mnt/project-files/llh-1022/llh-1119/design.md`.
//!
//! - [`suche`]: Vorwärtssuche über die FTS5-Tabelle aller Indexdateien;
//! - [`naechste_adresse`]: Rückwärtssuche über den R*-Baum;
//! - [`fuehre_zusammen`]: lokale Treffer vorn, Geocoder ergänzt, Duplikate fallen weg.
//!
//! DATENSCHUTZ: beides liest nur Dateien im Kartenverzeichnis, nichts verlässt den Server. Suchtext
//! und Koordinate stehen in keiner Log-Zeile.

use super::peilung::haversine_m;
use super::suche::{Ausschnitt, OrtTreffer};
use karten_katalog::adressindex::{normieren, ADRESSINDEX_ENDUNG, ADRESSINDEX_FORMAT};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{ConnectOptions, Connection, Row};
use std::path::{Path, PathBuf};

/// Höchstens so viele Treffer liefert die lokale Suche (wie der Geocoder, `suche::TREFFER_MAX`).
pub const TREFFER_MAX: usize = 5;
/// Kandidaten je Indexdatei, bevor nach Umgebung und Art gereiht wird.
const KANDIDATEN_JE_DATEI: i64 = 50;
/// Höchstens so viele Suchwörter gehen in die FTS-Abfrage.
const WOERTER_MAX: usize = 8;
/// Zwei Treffer gleichen Namens unter diesem Abstand sind derselbe Ort.
pub const DUPLIKAT_ABSTAND_M: f64 = 30.0;
/// Die Rückwärtssuche nimmt nur eine Adresse in diesem Umkreis.
pub const RUECKWAERTS_UMKREIS_M: f64 = 75.0;
/// Meter je Grad Breite (für den Suchkasten der Rückwärtssuche).
const M_JE_GRAD: f64 = 111_320.0;

/// Woher ein Treffer der Ortssuche stammt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quelle {
    OfflineKarte,
    Geocoder,
}

/// Ein Treffer der Ortssuche mit Quelle.
#[derive(Debug, Clone, PartialEq)]
pub struct Treffer {
    pub ort: OrtTreffer,
    pub quelle: Quelle,
}

/// Art einer Indexzeile (`adressen.art`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Art {
    Adresse,
    Strasse,
    Ort,
}

/// Ein Treffer aus einem Adressindex.
#[derive(Debug, Clone, PartialEq)]
pub struct LokalerTreffer {
    pub lat: f64,
    pub lon: f64,
    /// Anzeigename, mit Ortsteil („Bahnhofstraße 1, Altstadt, 12345 Musterstadt“).
    pub name: String,
    /// Kurzadresse „Straße Nr, PLZ Ort“ (ohne Ortsteil), Vergleichsgrundlage für Duplikate.
    pub kurz: String,
    art: Art,
    rang: f64,
}

impl LokalerTreffer {
    /// Ein Adress-Treffer für Tests anderer Module (Name = Kurzadresse).
    #[cfg(test)]
    pub(crate) fn fuer_test(lat: f64, lon: f64, name: &str) -> Self {
        LokalerTreffer {
            lat,
            lon,
            name: name.into(),
            kurz: name.into(),
            art: Art::Adresse,
            rang: 0.0,
        }
    }

    /// Als Treffer der Ortssuche. `kurz` nur, wenn es vom Namen abweicht: das Ortsfeld zeigt beide
    /// Zeilen, gleiche Zeilen doppelt wären Rauschen.
    pub fn als_ort_treffer(&self) -> OrtTreffer {
        OrtTreffer {
            lat: self.lat,
            lon: self.lon,
            name: self.name.clone(),
            kurz: (self.kurz != self.name).then(|| self.kurz.clone()),
        }
    }
}

/// Alle Indexdateien im Kartenverzeichnis, nach Namen sortiert (`.part` und Fremdes bleiben weg).
pub fn index_dateien(karten_dir: &Path) -> Vec<PathBuf> {
    let Ok(eintraege) = std::fs::read_dir(karten_dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = eintraege
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| n.ends_with(ADRESSINDEX_ENDUNG))
        })
        .map(|e| e.path())
        .collect();
    out.sort();
    out
}

/// FTS5-Ausdruck aus dem Suchtext: je Wort ein Präfix, Zahlen genau (als Präfix fände „12“ jede
/// Adresse mit PLZ 12345), alle Wörter müssen vorkommen. `None` ohne verwertbares Wort.
fn fts_ausdruck(q: &str) -> Option<String> {
    let norm = normieren(q);
    let woerter: Vec<String> = norm
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(WOERTER_MAX)
        .map(|w| {
            if w.chars().all(|c| c.is_ascii_digit()) {
                format!("\"{w}\"")
            } else {
                format!("\"{w}\"*")
            }
        })
        .collect();
    (!woerter.is_empty()).then(|| woerter.join(" AND "))
}

/// Öffnet eine Indexdatei schreibgeschützt und prüft das Format. Eine neue Verbindung je Suche:
/// ein getauschter Index wirkt sofort, und gesucht wird von Hand, nicht im Takt.
async fn oeffne(pfad: &Path) -> Option<SqliteConnection> {
    let mut c = match SqliteConnectOptions::new()
        .filename(pfad)
        .read_only(true)
        .immutable(true)
        .connect()
        .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(datei = %pfad.display(), "Adressindex nicht lesbar: {e}");
            return None;
        }
    };
    let format: Option<String> = sqlx::query_scalar("SELECT value FROM meta WHERE name = 'format'")
        .fetch_optional(&mut c)
        .await
        .ok()
        .flatten();
    if format.as_deref() != Some(ADRESSINDEX_FORMAT) {
        tracing::warn!(
            datei = %pfad.display(),
            "Adressindex in fremdem Format {format:?}, erwartet {ADRESSINDEX_FORMAT}"
        );
        let _ = c.close().await;
        return None;
    }
    Some(c)
}

/// Eine Zeile aus `adressen` in Namen übersetzt.
struct Zeile {
    art: Art,
    strasse: Option<String>,
    hausnummer: Option<String>,
    plz: Option<String>,
    ort: Option<String>,
    ortsteil: Option<String>,
    lat: f64,
    lon: f64,
}

impl Zeile {
    fn aus(r: &sqlx::sqlite::SqliteRow) -> Option<Zeile> {
        let art = match r.try_get::<String, _>("art").ok()?.as_str() {
            "adresse" => Art::Adresse,
            "strasse" => Art::Strasse,
            "ort" => Art::Ort,
            _ => return None,
        };
        Some(Zeile {
            art,
            strasse: r.try_get("strasse").ok()?,
            hausnummer: r.try_get("hausnummer").ok()?,
            plz: r.try_get("plz").ok()?,
            ort: r.try_get("ort").ok()?,
            ortsteil: r.try_get("ortsteil").ok()?,
            lat: r.try_get("lat").ok()?,
            lon: r.try_get("lon").ok()?,
        })
    }

    /// (Name, Kurzadresse). Kurz: „Straße Nr, PLZ Ort“; der Name nennt den Ortsteil dazwischen.
    fn namen(&self) -> (String, String) {
        let strasse = self.strasse.as_deref().map(|s| match &self.hausnummer {
            Some(nr) => format!("{s} {nr}"),
            None => s.to_string(),
        });
        let ort_zeile = [self.plz.as_deref(), self.ort.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        let ort_zeile = (!ort_zeile.is_empty()).then_some(ort_zeile);
        let kurz = [strasse.clone(), ort_zeile.clone()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let kurz = if kurz.is_empty() {
            self.ortsteil.clone().unwrap_or_default()
        } else {
            kurz.join(", ")
        };
        let ortsteil = self
            .ortsteil
            .clone()
            .filter(|t| Some(t) != self.ort.as_ref() && self.art != Art::Ort);
        let name = [strasse, ortsteil, ort_zeile]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let name = if name.is_empty() {
            kurz.clone()
        } else {
            name.join(", ")
        };
        (name, kurz)
    }
}

fn im_ausschnitt(a: &Ausschnitt, lat: f64, lon: f64) -> bool {
    (a.sued..=a.nord).contains(&lat) && (a.west..=a.ost).contains(&lon)
}

/// Sucht `q` in allen Indexdateien unter `karten_dir`. Reihung: Treffer im Ausschnitt um den
/// Einsatzort vorn; bei einer Zahl im Suchtext Adressen vor Straßen vor Orten, sonst umgekehrt;
/// dann die Nähe zum Einsatzort bzw. ohne ihn die FTS-Relevanz. Duplikate (mehrere Regionen decken denselben Ort) fallen weg.
pub async fn suche(
    karten_dir: &Path,
    q: &str,
    ausschnitt: Option<Ausschnitt>,
) -> Vec<LokalerTreffer> {
    let Some(ausdruck) = fts_ausdruck(q) else {
        return Vec::new();
    };
    let mit_zahl = q.chars().any(|c| c.is_ascii_digit());
    let mut alle = Vec::new();
    for datei in index_dateien(karten_dir) {
        let Some(mut c) = oeffne(&datei).await else {
            continue;
        };
        let zeilen = sqlx::query(
            "SELECT a.art, a.strasse, a.hausnummer, a.plz, a.ort, a.ortsteil, a.lat, a.lon, \
                    bm25(adressen_fts) AS rang \
             FROM adressen_fts JOIN adressen a ON a.id = adressen_fts.rowid \
             WHERE adressen_fts MATCH ? ORDER BY rang LIMIT ?",
        )
        .bind(&ausdruck)
        .bind(KANDIDATEN_JE_DATEI)
        .fetch_all(&mut c)
        .await;
        let _ = c.close().await;
        match zeilen {
            Ok(zeilen) => {
                for r in &zeilen {
                    let Some(z) = Zeile::aus(r) else { continue };
                    let rang: f64 = r.try_get("rang").unwrap_or(0.0);
                    let (name, kurz) = z.namen();
                    alle.push(LokalerTreffer {
                        lat: z.lat,
                        lon: z.lon,
                        name,
                        kurz,
                        art: z.art,
                        rang,
                    });
                }
            }
            // Ohne Suchtext im Log: er kann eine Adresse einer betroffenen Person sein.
            Err(e) => tracing::warn!(datei = %datei.display(), "Adressindex-Abfrage: {e}"),
        }
    }
    let art_rang = |a: Art| match (mit_zahl, a) {
        (true, a) => a as u8,
        (false, Art::Ort) => 0,
        (false, Art::Strasse) => 1,
        (false, Art::Adresse) => 2,
    };
    // Mit Ausschnitt entscheidet nach der Art die Nähe zu seiner Mitte (dem Einsatzort), sonst die
    // FTS-Relevanz.
    let mitte = ausschnitt.map(|a| ((a.sued + a.nord) / 2.0, (a.west + a.ost) / 2.0));
    let ferne = |t: &LokalerTreffer| mitte.map_or(t.rang, |m| haversine_m(m, (t.lat, t.lon)));
    alle.sort_by(|x, y| {
        let aussen =
            |t: &LokalerTreffer| ausschnitt.is_some_and(|a| !im_ausschnitt(&a, t.lat, t.lon));
        (aussen(x), art_rang(x.art))
            .cmp(&(aussen(y), art_rang(y.art)))
            .then(ferne(x).total_cmp(&ferne(y)))
    });
    let mut out: Vec<LokalerTreffer> = Vec::new();
    for t in alle {
        let doppelt = out.iter().any(|o| {
            o.art == t.art && gleicher_ort((o.lat, o.lon, &o.kurz), (t.lat, t.lon, &t.kurz))
        });
        if !doppelt {
            out.push(t);
        }
        if out.len() == TREFFER_MAX {
            break;
        }
    }
    out
}

/// Name für den Vergleich: normalisiert, Leerraum zusammengezogen.
fn vergleichsname(s: &str) -> String {
    normieren(s)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Gleicher Ort: Abstand unter [`DUPLIKAT_ABSTAND_M`] **und** gleicher Name.
fn gleicher_ort(a: (f64, f64, &str), b: (f64, f64, &str)) -> bool {
    haversine_m((a.0, a.1), (b.0, b.1)) < DUPLIKAT_ABSTAND_M
        && vergleichsname(a.2) == vergleichsname(b.2)
}

/// Lokale Treffer vorn, der Geocoder ergänzt bis [`TREFFER_MAX`]. Ein Geocoder-Treffer, der einem
/// lokalen gleicht (< 30 m, gleicher Name: seine Kurzadresse, sonst sein Name, gegen die lokale
/// Kurzadresse), fällt weg; der lokale bleibt.
pub fn fuehre_zusammen(lokal: &[LokalerTreffer], geocoder: Vec<OrtTreffer>) -> Vec<Treffer> {
    let mut out: Vec<Treffer> = lokal
        .iter()
        .take(TREFFER_MAX)
        .map(|t| Treffer {
            ort: t.als_ort_treffer(),
            quelle: Quelle::OfflineKarte,
        })
        .collect();
    for g in geocoder {
        if out.len() >= TREFFER_MAX {
            break;
        }
        let g_name = g.kurz.as_deref().unwrap_or(&g.name);
        let doppelt = lokal
            .iter()
            .any(|l| gleicher_ort((l.lat, l.lon, &l.kurz), (g.lat, g.lon, g_name)));
        if !doppelt {
            out.push(Treffer {
                ort: g,
                quelle: Quelle::Geocoder,
            });
        }
    }
    out
}

/// Name der nächsten Adresse im Umkreis von [`RUECKWAERTS_UMKREIS_M`], aus allen Indexdateien.
pub async fn naechste_adresse(karten_dir: &Path, lat: f64, lon: f64) -> Option<String> {
    let dlat = RUECKWAERTS_UMKREIS_M / M_JE_GRAD;
    let dlon = RUECKWAERTS_UMKREIS_M / (M_JE_GRAD * lat.to_radians().cos().max(0.01));
    let mut beste: Option<(f64, String)> = None;
    for datei in index_dateien(karten_dir) {
        let Some(mut c) = oeffne(&datei).await else {
            continue;
        };
        let zeilen = sqlx::query(
            "SELECT a.art, a.strasse, a.hausnummer, a.plz, a.ort, a.ortsteil, a.lat, a.lon \
             FROM adressen_rtree r JOIN adressen a ON a.id = r.id \
             WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?",
        )
        .bind(lat + dlat)
        .bind(lat - dlat)
        .bind(lon + dlon)
        .bind(lon - dlon)
        .fetch_all(&mut c)
        .await;
        let _ = c.close().await;
        let Ok(zeilen) = zeilen else {
            tracing::warn!(datei = %datei.display(), "Adressindex-Rückwärtssuche fehlgeschlagen");
            continue;
        };
        for r in &zeilen {
            let Some(z) = Zeile::aus(r) else { continue };
            let d = haversine_m((lat, lon), (z.lat, z.lon));
            if d <= RUECKWAERTS_UMKREIS_M && beste.as_ref().is_none_or(|(b, _)| d < *b) {
                beste = Some((d, z.namen().0));
            }
        }
    }
    beste.map(|(_, n)| n)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kartenverzeichnis mit dem Fixture-Index „Testgebiet“ (`tests/fixtures/adressindex/`).
    fn verzeichnis_mit_fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/adressindex/testgebiet.adressen.sqlite"),
            dir.path().join("testgebiet.adressen.sqlite"),
        )
        .unwrap();
        dir
    }

    fn namen(t: &[LokalerTreffer]) -> Vec<&str> {
        t.iter().map(|t| t.name.as_str()).collect()
    }

    #[test]
    fn fts_ausdruck_praefix_und_zahlen_genau() {
        assert_eq!(
            fts_ausdruck("Hauptstraße 12, Musterstadt").as_deref(),
            Some("\"hauptstrasse\"* AND \"12\" AND \"musterstadt\"*")
        );
        assert_eq!(
            fts_ausdruck("Hauptstr. 12a").as_deref(),
            Some("\"hauptstr\"* AND \"12a\"*")
        );
        // Anführungszeichen und FTS-Syntax im Suchtext werden Trenner, nie Operatoren.
        assert_eq!(
            fts_ausdruck("\"a\" OR b*").as_deref(),
            Some("\"a\"* AND \"or\"* AND \"b\"*")
        );
        assert_eq!(fts_ausdruck(" ,.- "), None);
    }

    #[tokio::test]
    async fn findet_hauptstrasse_12_in_musterstadt() {
        let dir = verzeichnis_mit_fixture();
        let t = suche(dir.path(), "Hauptstraße 12, Musterstadt", None).await;
        assert_eq!(namen(&t), ["Hauptstraße 12, 12345 Musterstadt"]);
        assert!((t[0].lat - 52.62).abs() < 1e-6 && (t[0].lon - 13.78).abs() < 1e-6);
    }

    #[tokio::test]
    async fn schreibweisen_ss_und_abkuerzung() {
        let dir = verzeichnis_mit_fixture();
        for q in ["hauptstrasse 12 musterstadt", "Hauptstr. 12 Musterst"] {
            let t = suche(dir.path(), q, None).await;
            assert_eq!(namen(&t), ["Hauptstraße 12, 12345 Musterstadt"], "{q}");
        }
    }

    #[tokio::test]
    async fn ohne_zahl_erst_strassen_dann_adressen() {
        let dir = verzeichnis_mit_fixture();
        let t = suche(dir.path(), "Hauptstraße Musterstadt", None).await;
        assert_eq!(t[0].name, "Hauptstraße, 12345 Musterstadt");
        assert_eq!(t.len(), 4, "{:?}", namen(&t));
    }

    #[tokio::test]
    async fn ortsname_allein_findet_den_ort_zuerst() {
        let dir = verzeichnis_mit_fixture();
        let t = suche(dir.path(), "Nachbardorf", None).await;
        assert_eq!(namen(&t)[0], "Nachbardorf");
    }

    #[tokio::test]
    async fn einsatzumgebung_kommt_vor_gleichnamigem_anderswo() {
        let dir = verzeichnis_mit_fixture();
        let ohne = suche(dir.path(), "Hauptstraße 12", None).await;
        assert_eq!(ohne.len(), 2);
        let nachbar = suche(
            dir.path(),
            "Hauptstraße 12",
            Some(Ausschnitt::um(52.70, 13.90)),
        )
        .await;
        assert_eq!(nachbar[0].name, "Hauptstraße 12, 12399 Nachbardorf");
        let muster = suche(
            dir.path(),
            "Hauptstraße 12",
            Some(Ausschnitt::um(52.62, 13.78)),
        )
        .await;
        assert_eq!(muster[0].name, "Hauptstraße 12, 12345 Musterstadt");
    }

    #[tokio::test]
    async fn ortsteil_steht_im_namen_nicht_in_der_kurzadresse() {
        let dir = verzeichnis_mit_fixture();
        let t = suche(dir.path(), "Bahnhofstraße 1", None).await;
        assert_eq!(t[0].name, "Bahnhofstraße 1, Altstadt, 12345 Musterstadt");
        assert_eq!(t[0].kurz, "Bahnhofstraße 1, 12345 Musterstadt");
        let o = t[0].als_ort_treffer();
        assert_eq!(
            o.kurz.as_deref(),
            Some("Bahnhofstraße 1, 12345 Musterstadt")
        );
        // Ohne Ortsteil gleicht die Kurzadresse dem Namen und entfällt.
        let h = suche(dir.path(), "Hauptstraße 14", None).await;
        assert_eq!(h[0].als_ort_treffer().kurz, None);
    }

    #[tokio::test]
    async fn ohne_index_oder_ohne_treffer_leer() {
        let leer = tempfile::tempdir().unwrap();
        assert!(suche(leer.path(), "Hauptstraße 12", None).await.is_empty());
        assert!(suche(&leer.path().join("fehlt"), "Hauptstraße", None)
            .await
            .is_empty());
        let dir = verzeichnis_mit_fixture();
        assert!(suche(dir.path(), "xyzzy", None).await.is_empty());
    }

    #[tokio::test]
    async fn kaputte_und_fremde_dateien_werden_uebersprungen() {
        let dir = verzeichnis_mit_fixture();
        std::fs::write(dir.path().join("kaputt.adressen.sqlite"), b"kein sqlite").unwrap();
        std::fs::write(dir.path().join("laedt.adressen.sqlite.part"), b"x").unwrap();
        let t = suche(dir.path(), "Hauptstraße 12, Musterstadt", None).await;
        assert_eq!(namen(&t), ["Hauptstraße 12, 12345 Musterstadt"]);
        assert_eq!(
            index_dateien(dir.path())
                .iter()
                .map(|p| p.file_name().unwrap().to_str().unwrap().to_string())
                .collect::<Vec<_>>(),
            ["kaputt.adressen.sqlite", "testgebiet.adressen.sqlite"]
        );
    }

    #[tokio::test]
    async fn zwei_regionen_mit_demselben_ort_liefern_ihn_einmal() {
        let dir = verzeichnis_mit_fixture();
        std::fs::copy(
            dir.path().join("testgebiet.adressen.sqlite"),
            dir.path().join("karte-7.adressen.sqlite"),
        )
        .unwrap();
        let t = suche(dir.path(), "Hauptstraße 12, Musterstadt", None).await;
        assert_eq!(namen(&t), ["Hauptstraße 12, 12345 Musterstadt"]);
    }

    #[tokio::test]
    async fn rueckwaertssuche_naechste_adresse_im_umkreis() {
        let dir = verzeichnis_mit_fixture();
        // ~11 m neben Hauptstraße 12.
        assert_eq!(
            naechste_adresse(dir.path(), 52.6201, 13.7800)
                .await
                .as_deref(),
            Some("Hauptstraße 12, 12345 Musterstadt")
        );
        // Gebäude-Way Nr. 13 (Mitte 52.6204 / 13.7803).
        assert_eq!(
            naechste_adresse(dir.path(), 52.62041, 13.78031)
                .await
                .as_deref(),
            Some("Hauptstraße 13, 12345 Musterstadt")
        );
        // ~1 km entfernt: nichts, auch kein Straßen- oder Ortseintrag.
        assert_eq!(naechste_adresse(dir.path(), 52.6300, 13.7650).await, None);
        let leer = tempfile::tempdir().unwrap();
        assert_eq!(naechste_adresse(leer.path(), 52.62, 13.78).await, None);
    }

    fn geo(lat: f64, lon: f64, name: &str, kurz: Option<&str>) -> OrtTreffer {
        OrtTreffer {
            lat,
            lon,
            name: name.into(),
            kurz: kurz.map(str::to_string),
        }
    }

    #[tokio::test]
    async fn zusammenfuehren_lokal_vorn_duplikat_faellt_weg() {
        let dir = verzeichnis_mit_fixture();
        let lokal = suche(dir.path(), "Hauptstraße 12, Musterstadt", None).await;
        let geocoder = vec![
            // ~15 m daneben, gleiche Kurzadresse anders geschrieben: Duplikat.
            geo(
                52.62013,
                13.78,
                "12, Hauptstraße, Musterstadt, Landkreis X, 12345, Deutschland",
                Some("Hauptstraße  12, 12345 musterstadt"),
            ),
            // Gleicher Name, aber 200 m weg: kein Duplikat.
            geo(
                52.6218,
                13.78,
                "anders",
                Some("Hauptstraße 12, 12345 Musterstadt"),
            ),
            // Nah, aber anderer Name: kein Duplikat.
            geo(
                52.6200,
                13.7801,
                "Hauptstraße 12a",
                Some("Hauptstraße 12a, 12345 Musterstadt"),
            ),
        ];
        let z = fuehre_zusammen(&lokal, geocoder);
        let quellen: Vec<(Quelle, &str)> =
            z.iter().map(|t| (t.quelle, t.ort.name.as_str())).collect();
        assert_eq!(
            quellen,
            [
                (Quelle::OfflineKarte, "Hauptstraße 12, 12345 Musterstadt"),
                (Quelle::Geocoder, "anders"),
                (Quelle::Geocoder, "Hauptstraße 12a"),
            ]
        );
    }

    #[test]
    fn zusammenfuehren_deckelt_auf_fuenf_und_vergleicht_ohne_kurz_den_namen() {
        let lokal: Vec<LokalerTreffer> = (0..3)
            .map(|i| LokalerTreffer {
                lat: 50.0 + f64::from(i),
                lon: 10.0,
                name: format!("L{i}"),
                kurz: format!("L{i}"),
                art: Art::Adresse,
                rang: 0.0,
            })
            .collect();
        let geocoder = vec![
            geo(50.0, 10.0, "l0", None), // Duplikat über den Namen
            geo(1.0, 1.0, "G1", None),
            geo(2.0, 2.0, "G2", None),
            geo(3.0, 3.0, "G3", None),
        ];
        let z = fuehre_zusammen(&lokal, geocoder);
        let namen: Vec<&str> = z.iter().map(|t| t.ort.name.as_str()).collect();
        assert_eq!(namen, ["L0", "L1", "L2", "G1", "G2"]);
    }
}
