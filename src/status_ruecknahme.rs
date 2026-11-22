//! Rücknahme eines Statuswechsels (LLH-1781 Fahrzeug, LLH-1986 Personal, Material, Einheit):
//! der gemeinsame Riegel und das Streichen des Zeitachsen-Ereignisses. Was zurückkommt, hält der
//! Server beim Wechsel selbst fest; vom Client zählen nur die Prüfwerte des Belegs. Regel:
//! `frontend/src/kraefte/AGENTS.md`, „Quittung und Rücknahme eines Statuswechsels“.

use sqlx::SqliteConnection;

use crate::error::AppError;
use crate::zeitachse::repo::{Beruehrt, Kraft};

/// Grund, mit dem die Rücknahme eines Statuswechsels sein Zeitachsen-Ereignis streicht (LLH-1781).
pub const GRUND_STATUS_RUECKNAHME: &str = "Statuswechsel zurückgenommen";

/// Der 409 einer Rücknahme durch eine andere Person oder nach der Frist.
pub fn conflict() -> AppError {
    AppError::Conflict(
        "Der Statuswechsel lässt sich nicht mehr zurücknehmen: nur direkt danach und nur von \
         der Person, die gewechselt hat"
            .into(),
    )
}

/// Was die Zeile über den letzten Wechsel festhält: der aktuelle Status, die Kennung des
/// Wechsels (beim Fahrzeug „Status seit“, sonst `status_gesetzt_at`) und wer gewechselt hat.
#[derive(Debug, Clone)]
pub struct Gemerkt<S> {
    pub status: S,
    pub kennung: Option<String>,
    pub gesetzt_von: Option<i64>,
}

/// Der Riegel der Rücknahme: Status oder Kennung inzwischen anders → `Veraltet` (409, CAS nach
/// `src/AGENTS.md`, Statuscode-Konvention); eine andere Person, ein Wechsel ohne Person oder mehr
/// als [`crate::entlassung::RUECKNAHME_FRIST_MINUTEN`] seit der Kennung → [`conflict`].
pub fn pruefe<S: PartialEq>(
    gemerkt: &Gemerkt<S>,
    beleg_status: &S,
    beleg_kennung: &str,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    if gemerkt.status != *beleg_status || gemerkt.kennung.as_deref() != Some(beleg_kennung) {
        return Err(AppError::Veraltet);
    }
    if gemerkt.gesetzt_von != Some(benutzer_id)
        || !crate::entlassung::is_in_ruecknahme_frist(beleg_kennung, jetzt)
    {
        return Err(conflict());
    }
    Ok(())
}

/// Streicht das Zeitachsen-Ereignis eines Statuswechsels mit [`GRUND_STATUS_RUECKNAHME`], aber
/// nur ein noch offenes Ereignis genau dieser Kraft; ein inzwischen gestrichenes oder fehlendes
/// bleibt, wie es ist. Bräche das Streichen die Ordnung der Zeitachse, ist es `Conflict`, und der
/// Aufrufer rollt alles zurück.
pub async fn streiche_ereignis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    kraft: Kraft,
    ereignis_id: Option<i64>,
) -> Result<Beruehrt, AppError> {
    let Some(ereignis) = ereignis_id else {
        return Ok(Beruehrt::default());
    };
    let sql = match kraft {
        Kraft::Einheit(_) => {
            "SELECT EXISTS(SELECT 1 FROM einsatz_kraft_zeitachse \
             WHERE id = ? AND einsatz_id = ? AND einheit_id = ? AND gestrichen_at IS NULL)"
        }
        Kraft::Person(_) => {
            "SELECT EXISTS(SELECT 1 FROM einsatz_kraft_zeitachse \
             WHERE id = ? AND einsatz_id = ? AND personal_id = ? AND gestrichen_at IS NULL)"
        }
    };
    let kraft_id = match kraft {
        Kraft::Einheit(id) | Kraft::Person(id) => id,
    };
    let offen: bool = sqlx::query_scalar(sql)
        .bind(ereignis)
        .bind(einsatz_id)
        .bind(kraft_id)
        .fetch_one(&mut *conn)
        .await?;
    if !offen {
        return Ok(Beruehrt::default());
    }
    let g = crate::zeitachse::repo::streiche_tx(
        conn,
        einsatz_id,
        benutzer_id,
        kraft,
        ereignis,
        GRUND_STATUS_RUECKNAHME,
        false,
    )
    .await
    .map_err(|e| match e {
        AppError::UnprocessableEntity(m) | AppError::Conflict(m) => AppError::Conflict(format!(
            "Der Statuswechsel lässt sich nicht zurücknehmen: {m}"
        )),
        andere => andere,
    })?;
    Ok(g.beruehrt)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KENNUNG: &str = "2026-11-22 10:00:00";

    fn gemerkt(status: Option<i64>, von: Option<i64>) -> Gemerkt<Option<i64>> {
        Gemerkt {
            status,
            kennung: Some(KENNUNG.to_string()),
            gesetzt_von: von,
        }
    }

    #[test]
    fn pruefe_gelingt_fuer_dieselbe_person_in_der_frist() {
        let g = gemerkt(Some(3), Some(7));
        assert!(pruefe(&g, &Some(3), KENNUNG, 7, "2026-11-22 10:10:00").is_ok());
    }

    #[test]
    fn anderer_status_ist_veraltet() {
        let g = gemerkt(Some(4), Some(7));
        let e = pruefe(&g, &Some(3), KENNUNG, 7, "2026-11-22 10:01:00").unwrap_err();
        assert!(matches!(e, AppError::Veraltet), "{e:?}");
    }

    #[test]
    fn andere_kennung_ist_veraltet() {
        let g = gemerkt(Some(3), Some(7));
        let e = pruefe(
            &g,
            &Some(3),
            "2026-11-22 09:59:00",
            7,
            "2026-11-22 10:01:00",
        )
        .unwrap_err();
        assert!(matches!(e, AppError::Veraltet), "{e:?}");
    }

    #[test]
    fn andere_person_ist_conflict() {
        let g = gemerkt(Some(3), Some(7));
        let e = pruefe(&g, &Some(3), KENNUNG, 8, "2026-11-22 10:01:00").unwrap_err();
        assert!(matches!(e, AppError::Conflict(_)), "{e:?}");
    }

    #[test]
    fn nach_elf_minuten_ist_conflict() {
        let g = gemerkt(Some(3), Some(7));
        let e = pruefe(&g, &Some(3), KENNUNG, 7, "2026-11-22 10:11:00").unwrap_err();
        assert!(matches!(e, AppError::Conflict(_)), "{e:?}");
    }

    #[test]
    fn ohne_gesetzt_von_ist_conflict() {
        let g = gemerkt(Some(3), None);
        let e = pruefe(&g, &Some(3), KENNUNG, 7, "2026-11-22 10:01:00").unwrap_err();
        assert!(matches!(e, AppError::Conflict(_)), "{e:?}");
    }

    #[test]
    fn geloeschter_status_wird_wie_ein_wert_verglichen() {
        let g = gemerkt(None, Some(7));
        assert!(pruefe(&g, &None, KENNUNG, 7, "2026-11-22 10:01:00").is_ok());
    }
}
