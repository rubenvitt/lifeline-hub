//! Rücknahme der Entlassung einer Person (LLH-1922, Spec `kraefte-entlassung`, „Entlassung einer
//! Person zurücknehmen“; `openspec/changes/u131h4rq-personal-entlassung-zuruecknehmen/design.md`).
//! Vorbild ist die Rücknahme beim Fahrzeug (`fahrzeug::disposition_repo::zuruecknehmen_tx`);
//! dazu kommen die Zeitachse und die Rollen außerhalb der eigenen Zeile.

use crate::entlassung::{BeendetAls, RuecknahmeAusgelassen};
use crate::error::AppError;
use crate::personal::PersonalEntlassungVorzustand;
use crate::zeitachse::repo::Kraft;
use sqlx::SqliteConnection;

/// Welche Module die Person beschreiben darf, in die die Rücknahme zurückbindet (design.md D4).
/// Ein Teil ohne Recht bleibt aus und wird genannt. Die Einsatzleitung braucht nur das
/// Schreibrecht im Einsatz, das das Gate der Route schon prüft.
#[derive(Debug, Clone, Copy)]
pub struct RuecknahmeRechte {
    pub einheiten: bool,
    pub fahrzeuge: bool,
    pub unfallhilfsstellen: bool,
    pub einsatzabschnitte: bool,
}

impl RuecknahmeRechte {
    /// Alle Rechte (Tests).
    pub const ALLE: Self = Self {
        einheiten: true,
        fahrzeuge: true,
        unfallhilfsstellen: true,
        einsatzabschnitte: true,
    };
}

/// Was die Rücknahme zurückgebunden hat (für die Live-Meldungen) und was sie ausgelassen hat.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Ruecknahme {
    /// Einheiten, in die die Person als Mitglied oder Führer zurückkam, ohne Doppel.
    pub einheiten: Vec<i64>,
    pub fahrzeug_id: Option<i64>,
    pub uhs_id: Option<i64>,
    pub abschnitte: Vec<i64>,
    pub einsatzleiter: bool,
    pub ausgelassen: Vec<RuecknahmeAusgelassen>,
}

fn ruecknahme_conflict() -> AppError {
    AppError::Conflict(
        "Die Entlassung lässt sich nicht mehr zurücknehmen; die Person lässt sich erneut \
         disponieren"
            .into(),
    )
}

fn zeitachse_conflict() -> AppError {
    AppError::Conflict(
        "Die Zeitachse der Person ist seit dem Entlassen berichtigt; die Person lässt sich \
         erneut disponieren"
            .into(),
    )
}

const OHNE_RECHT_EINHEITEN: &str = "kein Schreibrecht im Modul Einheiten";

/// Nimmt das Entlassen einer Person zurück (design.md D2–D5), in der Transaktion des Aufrufers.
///
/// Riegel: nur die entlassende Person, nur dieses Entlassen (`entlassen_at`), nur innerhalb von
/// [`crate::entlassung::RUECKNAHME_FRIST_MINUTEN`]; sonst `Conflict`. Ist die Zeitachse seit dem
/// Entlassen berichtigt (die Entlassung gestrichen oder nicht mehr das letzte Ereignis), ebenfalls
/// `Conflict`, bevor etwas geschrieben ist. Der Endzustand fällt; Status, Dispositionszeit,
/// Stärke-Position und Storno-Sperre bleiben. Die Entlassung dieses Entlassens wird mit
/// [`crate::entlassung::GRUND_RUECKNAHME`] gestrichen, so ist die Periode davor wieder offen.
/// Jede Bindung kommt nur zurück, wenn ihr Ziel frei ist und die Person das Recht des Moduls hat;
/// sonst steht sie in `ausgelassen`.
pub async fn zuruecknehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    benutzer_id: i64,
    jetzt: &str,
    vorzustand: &PersonalEntlassungVorzustand,
    rechte: RuecknahmeRechte,
) -> Result<Ruecknahme, AppError> {
    let zeile: Option<(String, Option<String>, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT snap_name, beendet_at, beendet_von, beendet_als FROM einsatz_personal \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (snap_name, beendet_at, beendet_von, beendet_als) = zeile.ok_or(AppError::NotFound)?;
    let im_riegel = beendet_als.as_deref() == Some(BeendetAls::Entlassen.as_str())
        && beendet_von == Some(benutzer_id)
        && beendet_at.as_deref() == Some(vorzustand.entlassen_at.as_str())
        && crate::entlassung::is_in_ruecknahme_frist(&vorzustand.entlassen_at, jetzt);
    if !im_riegel {
        return Err(ruecknahme_conflict());
    }
    let entlassung = find_entlassung_tx(conn, einsatz_id, ep_id, &vorzustand.entlassen_at).await?;

    let r = sqlx::query(
        "UPDATE einsatz_personal SET beendet_at = NULL, beendet_von = NULL, beendet_als = NULL \
         WHERE id = ? AND einsatz_id = ? AND beendet_at = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .bind(&vorzustand.entlassen_at)
    .execute(&mut *conn)
    .await?;
    if r.rows_affected() == 0 {
        return Err(ruecknahme_conflict());
    }
    if let Some(id) = entlassung {
        crate::zeitachse::repo::streiche_tx(
            conn,
            einsatz_id,
            benutzer_id,
            Kraft::Person(ep_id),
            id,
            crate::entlassung::GRUND_RUECKNAHME,
            false,
        )
        .await?;
    }

    let mut ergebnis = Ruecknahme::default();
    if let Some(einheit_id) = vorzustand.einheit_id {
        bind_einheit_tx(conn, einsatz_id, ep_id, einheit_id, rechte, &mut ergebnis).await?;
    }
    for &einheit_id in &vorzustand.gefuehrte_einheiten {
        bind_fuehrung_tx(conn, einsatz_id, ep_id, einheit_id, rechte, &mut ergebnis).await?;
    }
    if let Some(ef_id) = vorzustand.fahrzeug_id {
        bind_fahrzeug_tx(conn, einsatz_id, ep_id, ef_id, rechte, &mut ergebnis).await?;
    }
    if let Some(uhs_id) = vorzustand.uhs_id {
        bind_uhs_tx(conn, einsatz_id, ep_id, uhs_id, rechte, &mut ergebnis).await?;
    }
    for &abschnitt_id in &vorzustand.geleitete_abschnitte {
        bind_abschnitt_tx(conn, einsatz_id, ep_id, abschnitt_id, rechte, &mut ergebnis).await?;
    }
    if vorzustand.einsatzleiter {
        bind_einsatzleitung_tx(conn, einsatz_id, ep_id, &snap_name, &mut ergebnis).await?;
    }
    Ok(ergebnis)
}

/// Die Entlassung dieses Entlassens in der Zeitachse (design.md D3): `None`, wenn das Entlassen
/// keine geschrieben hat (keine offene Periode). `Conflict`, wenn sie seither gestrichen ist oder
/// ein ungestrichenes Ereignis der Person nach ihr steht.
async fn find_entlassung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    entlassen_at: &str,
) -> Result<Option<i64>, AppError> {
    let ereignis: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT id, gestrichen_at FROM einsatz_kraft_zeitachse \
         WHERE personal_id = ? AND einsatz_id = ? AND art = 'entlassung' \
           AND quelle = 'disposition' AND zeitpunkt_at = ? AND ursprung_id IS NULL \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .bind(entlassen_at)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((id, gestrichen_at)) = ereignis else {
        return Ok(None);
    };
    if gestrichen_at.is_some() {
        return Err(zeitachse_conflict());
    }
    let danach: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM einsatz_kraft_zeitachse \
                       WHERE personal_id = ?1 AND gestrichen_at IS NULL AND id <> ?2 \
                         AND (zeitpunkt_at > ?3 OR (zeitpunkt_at = ?3 AND id > ?2)))",
    )
    .bind(ep_id)
    .bind(id)
    .bind(entlassen_at)
    .fetch_one(&mut *conn)
    .await?;
    if danach {
        return Err(zeitachse_conflict());
    }
    Ok(Some(id))
}

/// Name und Auflösungszeitpunkt einer Einheit des Einsatzes; `None`, wenn sie fehlt (spurlos
/// aufgelöst und gelöscht, `einheit::repo::aufloesen_tx`).
async fn load_einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<Option<(String, Option<String>)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT name, aufgeloest_at FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?)
}

fn merke_einheit(ergebnis: &mut Ruecknahme, einheit_id: i64) {
    if !ergebnis.einheiten.contains(&einheit_id) {
        ergebnis.einheiten.push(einheit_id);
    }
}

async fn bind_einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    einheit_id: i64,
    rechte: RuecknahmeRechte,
    ergebnis: &mut Ruecknahme,
) -> Result<(), AppError> {
    let aus = |b: String, g: &str| RuecknahmeAusgelassen::new(b, g);
    match load_einheit_tx(conn, einsatz_id, einheit_id).await? {
        None => ergebnis
            .ausgelassen
            .push(aus("Einheit".into(), "inzwischen aufgelöst")),
        Some((name, _)) if !rechte.einheiten => ergebnis
            .ausgelassen
            .push(aus(format!("Einheit «{name}»"), OHNE_RECHT_EINHEITEN)),
        Some((name, Some(_))) => ergebnis
            .ausgelassen
            .push(aus(format!("Einheit «{name}»"), "inzwischen aufgelöst")),
        Some((name, None)) => {
            // Bewusst nicht `einheit::mitglied_repo::zuordnen_personal_tx`: das endet jede
            // Führung der Person, die gleich danach zurückkommt.
            let r = sqlx::query(
                "UPDATE einsatz_personal SET einheit_id = ? \
                 WHERE id = ? AND einsatz_id = ? AND einheit_id IS NULL",
            )
            .bind(einheit_id)
            .bind(ep_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
            if r.rows_affected() == 1 {
                merke_einheit(ergebnis, einheit_id);
            } else {
                ergebnis.ausgelassen.push(aus(
                    format!("Einheit «{name}»"),
                    "inzwischen in einer anderen Einheit",
                ));
            }
        }
    }
    Ok(())
}

async fn bind_fuehrung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    einheit_id: i64,
    rechte: RuecknahmeRechte,
    ergebnis: &mut Ruecknahme,
) -> Result<(), AppError> {
    let aus = |b: String, g: &str| RuecknahmeAusgelassen::new(b, g);
    match load_einheit_tx(conn, einsatz_id, einheit_id).await? {
        None => ergebnis
            .ausgelassen
            .push(aus("Führung einer Einheit".into(), "inzwischen aufgelöst")),
        Some((name, _)) if !rechte.einheiten => ergebnis
            .ausgelassen
            .push(aus(format!("Führung von «{name}»"), OHNE_RECHT_EINHEITEN)),
        Some((name, Some(_))) => ergebnis
            .ausgelassen
            .push(aus(format!("Führung von «{name}»"), "inzwischen aufgelöst")),
        Some((name, None)) => {
            let r = sqlx::query(
                "UPDATE einsatz_einheit SET fuehrer_id = ? \
                 WHERE id = ? AND einsatz_id = ? AND fuehrer_id IS NULL AND aufgeloest_at IS NULL",
            )
            .bind(ep_id)
            .bind(einheit_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
            if r.rows_affected() == 1 {
                merke_einheit(ergebnis, einheit_id);
            } else {
                ergebnis.ausgelassen.push(aus(
                    format!("Führung von «{name}»"),
                    "inzwischen anders besetzt",
                ));
            }
        }
    }
    Ok(())
}

async fn bind_fahrzeug_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    ef_id: i64,
    rechte: RuecknahmeRechte,
    ergebnis: &mut Ruecknahme,
) -> Result<(), AppError> {
    let fahrzeug: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT COALESCE(f.funkrufname, ef.snap_funkrufname), ef.beendet_at \
         FROM einsatz_fahrzeug ef LEFT JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
         WHERE ef.id = ? AND ef.einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let aus = |b: String, g: &str| RuecknahmeAusgelassen::new(b, g);
    match fahrzeug {
        None => ergebnis
            .ausgelassen
            .push(aus("Fahrzeug".into(), "nicht mehr im Einsatz")),
        Some((name, _)) if !rechte.fahrzeuge => ergebnis.ausgelassen.push(aus(
            format!("Fahrzeug «{name}»"),
            "kein Schreibrecht im Modul Fahrzeuge",
        )),
        Some((name, Some(_))) => ergebnis
            .ausgelassen
            .push(aus(format!("Fahrzeug «{name}»"), "nicht mehr im Einsatz")),
        Some((name, None)) => {
            let r = sqlx::query(
                "UPDATE einsatz_personal SET fahrzeug_id = ? \
                 WHERE id = ? AND einsatz_id = ? AND fahrzeug_id IS NULL",
            )
            .bind(ef_id)
            .bind(ep_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
            if r.rows_affected() == 1 {
                ergebnis.fahrzeug_id = Some(ef_id);
            } else {
                ergebnis.ausgelassen.push(aus(
                    format!("Fahrzeug «{name}»"),
                    "inzwischen auf einem anderen Fahrzeug",
                ));
            }
        }
    }
    Ok(())
}

async fn bind_uhs_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    uhs_id: i64,
    rechte: RuecknahmeRechte,
    ergebnis: &mut Ruecknahme,
) -> Result<(), AppError> {
    let uhs: Option<(String, String)> =
        sqlx::query_as("SELECT bezeichnung, status FROM uhs WHERE id = ? AND einsatz_id = ?")
            .bind(uhs_id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    let aus = |b: String, g: &str| RuecknahmeAusgelassen::new(b, g);
    match uhs {
        None => ergebnis
            .ausgelassen
            .push(aus("UHS".into(), "nicht mehr vorhanden")),
        Some((name, _)) if !rechte.unfallhilfsstellen => ergebnis.ausgelassen.push(aus(
            format!("UHS «{name}»"),
            "kein Schreibrecht im Modul Unfallhilfsstellen",
        )),
        Some((name, status)) if status == "aufgeloest" => ergebnis
            .ausgelassen
            .push(aus(format!("UHS «{name}»"), "inzwischen aufgelöst")),
        Some((name, _)) => {
            let r = sqlx::query(
                "UPDATE einsatz_personal SET uhs_id = ? \
                 WHERE id = ? AND einsatz_id = ? AND uhs_id IS NULL",
            )
            .bind(uhs_id)
            .bind(ep_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
            if r.rows_affected() == 1 {
                ergebnis.uhs_id = Some(uhs_id);
            } else {
                ergebnis.ausgelassen.push(aus(
                    format!("UHS «{name}»"),
                    "inzwischen an einer anderen UHS",
                ));
            }
        }
    }
    Ok(())
}

async fn bind_abschnitt_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    abschnitt_id: i64,
    rechte: RuecknahmeRechte,
    ergebnis: &mut Ruecknahme,
) -> Result<(), AppError> {
    let name: Option<String> =
        sqlx::query_scalar("SELECT name FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
            .bind(abschnitt_id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    let aus = |b: String, g: &str| RuecknahmeAusgelassen::new(b, g);
    match name {
        None => ergebnis.ausgelassen.push(aus(
            "Leitung eines Abschnitts".into(),
            "Abschnitt nicht mehr vorhanden",
        )),
        Some(name) if !rechte.einsatzabschnitte => ergebnis.ausgelassen.push(aus(
            format!("Leitung von «{name}»"),
            "kein Schreibrecht im Modul Einsatzabschnitte",
        )),
        Some(name) => {
            let r = sqlx::query(
                "UPDATE einsatzabschnitt SET leiter_id = ? \
                 WHERE id = ? AND einsatz_id = ? AND leiter_id IS NULL",
            )
            .bind(ep_id)
            .bind(abschnitt_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
            if r.rows_affected() == 1 {
                ergebnis.abschnitte.push(abschnitt_id);
            } else {
                ergebnis.ausgelassen.push(aus(
                    format!("Leitung von «{name}»"),
                    "inzwischen anders besetzt",
                ));
            }
        }
    }
    Ok(())
}

/// Die Einsatzleitung kommt nur zurück, wenn kein anderer Einsatzleiter eingetragen ist
/// (design.md D5): die Zeile trägt noch den Vermerk „nicht mehr disponiert“ dieser Person (Art
/// `personal`, ohne Verweis, ihr eingefrorener Name). Name und „seit“ bleiben, wie sie waren.
async fn bind_einsatzleitung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    snap_name: &str,
    ergebnis: &mut Ruecknahme,
) -> Result<(), AppError> {
    let r = sqlx::query(
        "UPDATE einsatz_fuehrungsstelle SET einsatzleiter_personal_id = ? \
         WHERE einsatz_id = ? AND einsatzleiter_art = 'personal' \
           AND einsatzleiter_personal_id IS NULL AND einsatzleiter_name = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .bind(snap_name)
    .execute(&mut *conn)
    .await?;
    if r.rows_affected() == 1 {
        ergebnis.einsatzleiter = true;
        return Ok(());
    }
    let art: Option<Option<String>> = sqlx::query_scalar(
        "SELECT einsatzleiter_art FROM einsatz_fuehrungsstelle WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let grund = match art.flatten() {
        Some(_) => "inzwischen anders besetzt",
        None => "inzwischen ausgetragen",
    };
    ergebnis
        .ausgelassen
        .push(RuecknahmeAusgelassen::new("Einsatzleitung", grund));
    Ok(())
}

#[cfg(test)]
mod tests;
