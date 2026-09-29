//! Funktion eines Mitglieds im Einsatz (LFH-615): „S2 Lage“ im Kopf, „Vitt · S2“ am
//! ETB-Verfasser.
//!
//! Die Funktion ist kein gespeichertes Feld, sondern folgt aus zwei Achsen:
//!
//! 1. **Besetzte Sachgebiete** (`einsatz_stabsfunktion`, über `personal.benutzer_id`) — die
//!    stärkere Aussage, sie gewinnt.
//! 2. **Einsatzrolle `einsatzleitung`** → „EL“, aber nur ohne Sachgebiet; die Rolle ist die
//!    Rechteachse und kann auch ein Führungsassistent tragen.
//!
//! Sonst gibt es keine Funktion, statt eine zu erfinden.
//!
//! `fuehrungsstelle` fließt nicht ein: sie ist die Empfänger-Vorbelegung der ETB-Erfassung und
//! steht in der Schwärzungs-Registry auf `Scrub` — ein ETB-Snapshot davon hebelte die
//! Schwärzung aus.
//!
//! Die Ableitung liegt im Backend, weil der ETB-Snapshot ein Führungsnachweis ist und nicht vom
//! erzeugenden Frontend abhängen darf.

use super::EinsatzRolle;
use crate::error::AppError;
use crate::stab::Sachgebiet;
use sqlx::SqliteConnection;

/// Abgeleitete Funktion in zwei Schreibweisen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Funktion {
    /// Kurzform für den ETB-Verfasser: „S2", „S2/S3", „EL".
    pub kurz: String,
    /// Klartext für den Kopf: „S2 Lage", „S2/S3", „Einsatzleitung".
    pub bezeichnung: String,
}

/// Leitet die Funktion ab. Rein — Einsatzkopf und ETB-Snapshot rufen genau diese Funktion.
///
/// Mehrere Sachgebiete werden alle genannt, in S1–S6-Folge ohne Dubletten („S2/S3“): ein still
/// weggelassenes S3 wäre im Nachweis eine Lücke. Der Klartext entfällt dann, weil er die
/// Kopfzeile sprengte.
pub fn ableiten(sachgebiete: &[Sachgebiet], rolle: Option<EinsatzRolle>) -> Option<Funktion> {
    let mut sg: Vec<Sachgebiet> = sachgebiete.to_vec();
    sg.sort();
    sg.dedup();
    match sg.as_slice() {
        [] => match rolle {
            Some(EinsatzRolle::Einsatzleitung) => Some(Funktion {
                kurz: "EL".into(),
                bezeichnung: "Einsatzleitung".into(),
            }),
            _ => None,
        },
        [einziges] => Some(Funktion {
            kurz: kuerzel(*einziges),
            bezeichnung: einziges.kurz_mit_label(),
        }),
        mehrere => {
            let kurz = mehrere
                .iter()
                .map(|s| kuerzel(*s))
                .collect::<Vec<_>>()
                .join("/");
            Some(Funktion {
                bezeichnung: kurz.clone(),
                kurz,
            })
        }
    }
}

fn kuerzel(sg: Sachgebiet) -> String {
    sg.as_str().to_uppercase()
}

/// Lädt Rolle und Sachgebiete auf einer beliebigen Verbindung und leitet die Kurzform ab — für
/// den ETB-Snapshot in `etb::repo::anlegen_tx`, in derselben Transaktion wie der Eintrag.
pub async fn kurz_fuer(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<String>, AppError> {
    let rolle: Option<String> = sqlx::query_scalar(
        "SELECT einsatz_rolle FROM einsatz_mitgliedschaft WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(&mut *conn)
    .await?;
    let sachgebiete =
        crate::stab::repo::sachgebiete_von_conn(&mut *conn, einsatz_id, benutzer_id).await?;
    Ok(ableiten(&sachgebiete, rolle.as_deref().and_then(EinsatzRolle::parse)).map(|f| f.kurz))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(kurz: &str, bezeichnung: &str) -> Option<Funktion> {
        Some(Funktion {
            kurz: kurz.into(),
            bezeichnung: bezeichnung.into(),
        })
    }

    #[test]
    fn ein_sachgebiet_traegt_klartext() {
        assert_eq!(ableiten(&[Sachgebiet::S2], None), f("S2", "S2 Lage"));
    }

    #[test]
    fn sachgebiet_gewinnt_gegen_einsatzleitung() {
        assert_eq!(
            ableiten(&[Sachgebiet::S3], Some(EinsatzRolle::Einsatzleitung)),
            f("S3", "S3 Einsatz")
        );
    }

    #[test]
    fn einsatzleitung_ohne_sachgebiet_ist_el() {
        assert_eq!(
            ableiten(&[], Some(EinsatzRolle::Einsatzleitung)),
            f("EL", "Einsatzleitung")
        );
    }

    #[test]
    fn mehrere_sachgebiete_alle_sortiert_ohne_dubletten() {
        assert_eq!(
            ableiten(
                &[Sachgebiet::S3, Sachgebiet::S2, Sachgebiet::S3],
                Some(EinsatzRolle::Fuehrungspersonal)
            ),
            f("S2/S3", "S2/S3")
        );
    }

    #[test]
    fn ohne_besetzung_und_ohne_leitung_keine_funktion() {
        assert_eq!(ableiten(&[], Some(EinsatzRolle::Fuehrungspersonal)), None);
        assert_eq!(ableiten(&[], Some(EinsatzRolle::Beobachter)), None);
        assert_eq!(ableiten(&[], None), None);
    }
}
