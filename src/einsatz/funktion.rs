//! Funktion eines Mitglieds im Einsatz (LFH-615): „S2 Lage“ im Kopf, „Vitt · S2“ am
//! ETB-Verfasser.
//!
//! Die Funktion ist kein eigenes Feld, sondern folgt aus der Mitgliedschaft (i6k6mzed,
//! `openspec/changes/archive/2026-11-09-i6k6mzed-stab-herausnehmen/design.md` D2):
//!
//! 1. **Führungsfunktion der Mitgliedschaft** (`einsatz_mitgliedschaft.fuehrungsfunktion`, der
//!    ganze Katalog) — die stärkere Aussage, sie gewinnt.
//! 2. **Einsatzrolle `einsatzleitung`** → „EL“, aber nur ohne Führungsfunktion; die Rolle ist die
//!    Rechteachse und kann auch ein Führungsassistent tragen.
//!
//! Sonst gibt es keine Funktion, statt eine zu erfinden. Ein Freitext ohne Code ist keine
//! Funktion (kein Rückschluss vom Freitext auf einen Code, `fuehrung`).
//!
//! Die Bezeichnung von Führungshilfspersonal und Fachberater (`fuehrungsstelle`) steht nur im
//! Klartext des Kopfs, nie in der Kurzform: sie steht in der Schwärzungs-Registry auf `Scrub`, ein
//! ETB-Snapshot davon hebelte die Schwärzung aus.
//!
//! Die Ableitung liegt im Backend, weil der ETB-Snapshot ein Führungsnachweis ist und nicht vom
//! erzeugenden Frontend abhängen darf.

use super::EinsatzRolle;
use crate::error::AppError;
use crate::fuehrung::{Fuehrungsfunktion, Labelkarte};
use sqlx::SqliteConnection;

/// Abgeleitete Funktion in zwei Schreibweisen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Funktion {
    /// Katalogcode, auch beim Fallback „EL“ (`el`): Quelle von `meine_funktion_code`, mit dem
    /// „meine Stelle“ im Überblick abgleicht (pkjvl5iy, design.md D1).
    pub code: Fuehrungsfunktion,
    /// Kurzform für den ETB-Verfasser: „S2", „EL", „Fachberater".
    pub kurz: String,
    /// Klartext für den Kopf: „S2 Lage", „Einsatzleitung", „Fachberater: THW".
    pub bezeichnung: String,
}

/// Leitet die Funktion ab. Rein — Einsatzkopf und ETB-Snapshot rufen genau diese Funktion.
///
/// Der Klartext trägt das wirksame Mandantenlabel (LFH-549, `karte`): THW sieht „S4 Versorgung
/// (Logistik)“; bei Führungshilfspersonal und Fachberater dazu die Bezeichnung. Die Kurzform ist
/// labelunabhängig: das Kürzel, bei Führungshilfspersonal und Fachberater das Standardlabel.
pub fn ableiten(
    funktion: Option<Fuehrungsfunktion>,
    bezeichnung: Option<&str>,
    rolle: Option<EinsatzRolle>,
    karte: &Labelkarte,
) -> Option<Funktion> {
    match funktion {
        Some(f) => Some(Funktion {
            code: f,
            kurz: f
                .kuerzel()
                .unwrap_or_else(|| f.standard_label())
                .to_string(),
            bezeichnung: karte.anzeige(f, bezeichnung),
        }),
        None => match rolle {
            Some(EinsatzRolle::Einsatzleitung) => Some(Funktion {
                code: Fuehrungsfunktion::El,
                kurz: "EL".into(),
                bezeichnung: karte.label(Fuehrungsfunktion::El).to_string(),
            }),
            _ => None,
        },
    }
}

/// Lädt Rolle und Führungsfunktion auf einer beliebigen Verbindung und leitet die Kurzform ab —
/// für den ETB-Snapshot in `etb::repo::anlegen_tx`, in derselben Transaktion wie der Eintrag.
pub async fn kurz_fuer(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<String>, AppError> {
    let zeile: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT einsatz_rolle, fuehrungsfunktion FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((rolle, code)) = zeile else {
        return Ok(None);
    };
    // Nur die Kurzform — sie ist labelunabhängig, die Standardkarte genügt; die Bezeichnung
    // fließt in sie nicht ein.
    Ok(ableiten(
        code.as_deref().and_then(Fuehrungsfunktion::parse),
        None,
        EinsatzRolle::parse(&rolle),
        &Labelkarte::standard(),
    )
    .map(|f| f.kurz))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn std() -> Labelkarte {
        Labelkarte::standard()
    }

    fn f(code: Fuehrungsfunktion, kurz: &str, bezeichnung: &str) -> Option<Funktion> {
        Some(Funktion {
            code,
            kurz: kurz.into(),
            bezeichnung: bezeichnung.into(),
        })
    }

    #[test]
    fn mandantenlabel_gilt_im_klartext_nicht_in_der_kurzform() {
        let mut karte = Labelkarte::standard();
        karte
            .ueberschrieben
            .insert(Fuehrungsfunktion::S4, "Versorgung (Logistik)".into());
        assert_eq!(
            ableiten(Some(Fuehrungsfunktion::S4), None, None, &karte),
            f(Fuehrungsfunktion::S4, "S4", "S4 Versorgung (Logistik)")
        );
    }

    #[test]
    fn ein_sachgebiet_traegt_klartext() {
        assert_eq!(
            ableiten(Some(Fuehrungsfunktion::S2), None, None, &std()),
            f(Fuehrungsfunktion::S2, "S2", "S2 Lage")
        );
    }

    #[test]
    fn funktion_gewinnt_gegen_einsatzleitung() {
        assert_eq!(
            ableiten(
                Some(Fuehrungsfunktion::S3),
                None,
                Some(EinsatzRolle::Einsatzleitung),
                &std()
            ),
            f(Fuehrungsfunktion::S3, "S3", "S3 Einsatz")
        );
    }

    #[test]
    fn einsatzleitung_ohne_funktion_ist_el() {
        assert_eq!(
            ableiten(None, None, Some(EinsatzRolle::Einsatzleitung), &std()),
            f(Fuehrungsfunktion::El, "EL", "Einsatzleitung")
        );
        assert_eq!(
            ableiten(Some(Fuehrungsfunktion::El), None, None, &std()),
            f(Fuehrungsfunktion::El, "EL", "Einsatzleitung")
        );
    }

    /// Der ganze Katalog (D2): S7 und Fachberater sind Funktionen; die Bezeichnung steht nur im
    /// Klartext.
    #[test]
    fn s7_und_fachberater_sind_funktionen() {
        assert_eq!(
            ableiten(Some(Fuehrungsfunktion::S7), None, None, &std()),
            f(
                Fuehrungsfunktion::S7,
                "S7",
                "S7 Psychosoziale Notfallversorgung"
            )
        );
        assert_eq!(
            ableiten(
                Some(Fuehrungsfunktion::Fachberater),
                Some("THW"),
                None,
                &std()
            ),
            f(
                Fuehrungsfunktion::Fachberater,
                "Fachberater",
                "Fachberater: THW"
            )
        );
    }

    #[test]
    fn ohne_funktion_und_ohne_leitung_keine_funktion() {
        assert_eq!(
            ableiten(None, None, Some(EinsatzRolle::Fuehrungspersonal), &std()),
            None
        );
        assert_eq!(
            ableiten(None, None, Some(EinsatzRolle::Beobachter), &std()),
            None
        );
        assert_eq!(ableiten(None, None, None, &std()), None);
    }
}
