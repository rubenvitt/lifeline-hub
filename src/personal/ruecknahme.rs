//! Rücknahme der Entlassung einer Person (LLH-1922, Spec `kraefte-entlassung`, „Entlassung einer
//! Person zurücknehmen“; `openspec/changes/archive/2026-11-17-u131h4rq-personal-entlassung-zuruecknehmen/design.md`).
//! Vorbild ist die Rücknahme beim Fahrzeug (`fahrzeug::disposition_repo::zuruecknehmen_tx`);
//! dazu kommen die Zeitachse und die Rollen außerhalb der eigenen Zeile.

use crate::entlassung::{BeendetAls, RuecknahmeAusgelassen};
use crate::error::AppError;
use crate::personal::PersonalEntlassungVorzustand;
use crate::zeitachse::repo::Kraft;
use sqlx::SqliteConnection;

/// Welche Module die Person beschreiben darf, in die die Rücknahme zurückbindet (design.md D4/D5).
/// Ein Teil ohne Recht bleibt aus und wird genannt, ohne den Namen aus dem fremden Modul.
#[derive(Debug, Clone, Copy)]
pub struct RuecknahmeRechte {
    /// Einsatzdaten: das Recht, den Einsatzleiter zu setzen (Gate der Führungsstelle,
    /// `EinsatzVerwaltungszugriff`).
    pub einsatzdaten: bool,
    pub einheiten: bool,
    pub fahrzeuge: bool,
    pub unfallhilfsstellen: bool,
    pub einsatzabschnitte: bool,
}

impl RuecknahmeRechte {
    /// Alle Rechte (Tests).
    pub const ALLE: Self = Self {
        einsatzdaten: true,
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
/// Entlassen berichtigt (ein Ereignis der Person seitdem gestrichen oder erfasst), ebenfalls
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
    let zeile: Option<(Option<String>, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT beendet_at, beendet_von, beendet_als FROM einsatz_personal \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (beendet_at, beendet_von, beendet_als) = zeile.ok_or(AppError::NotFound)?;
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
    // Der Führer ist Mitglied seiner Einheit (`einheit::repo::check_fuehrer`): ein echter
    // Vorzustand nennt höchstens die eigene Einheit. Alles andere bleibt still aus, sonst stünden
    // Namen fremder Einheiten im Einsatztagebuch (Review vor dem PR).
    let fuehrung: Vec<i64> = vorzustand
        .gefuehrte_einheiten
        .iter()
        .copied()
        .filter(|id| Some(*id) == vorzustand.einheit_id)
        .collect();
    if !fuehrung.is_empty() {
        bind_fuehrung_tx(
            conn,
            einsatz_id,
            ep_id,
            benutzer_id,
            &fuehrung,
            rechte,
            &mut ergebnis,
        )
        .await?;
    }
    if let Some(ef_id) = vorzustand.fahrzeug_id {
        bind_fahrzeug_tx(conn, einsatz_id, ep_id, ef_id, rechte, &mut ergebnis).await?;
    }
    if let Some(uhs_id) = vorzustand.uhs_id {
        bind_uhs_tx(conn, einsatz_id, ep_id, uhs_id, rechte, &mut ergebnis).await?;
    }
    if !vorzustand.geleitete_abschnitte.is_empty() {
        bind_abschnitte_tx(
            conn,
            einsatz_id,
            ep_id,
            &vorzustand.geleitete_abschnitte,
            rechte,
            &mut ergebnis,
        )
        .await?;
    }
    if let Some(name) = &vorzustand.einsatzleiter_name {
        if rechte.einsatzdaten {
            bind_einsatzleitung_tx(conn, einsatz_id, ep_id, benutzer_id, name, &mut ergebnis)
                .await?;
        } else {
            ergebnis.ausgelassen.push(RuecknahmeAusgelassen::new(
                "Einsatzleitung",
                "kein Schreibrecht für die Einsatzdaten",
            ));
        }
    }
    Ok(ergebnis)
}

/// Die Entlassung dieses Entlassens in der Zeitachse (design.md D3): `None`, wenn das Entlassen
/// keine geschrieben hat (keine offene Periode). `Conflict`, wenn die Zeitachse der Person seit dem
/// Entlassen berichtigt ist: die Entlassung gestrichen, ein Ereignis danach erfasst (Nachtrag,
/// „Zeit berichtigen“, „Periode nachtragen“) oder eines gestrichen. Erfasst- und Streichzeit stehen
/// im selben Format wie `entlassen_at` (`crate::zeit::FORMAT`).
async fn find_entlassung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    entlassen_at: &str,
) -> Result<Option<i64>, AppError> {
    let ereignis: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_kraft_zeitachse \
         WHERE personal_id = ? AND einsatz_id = ? AND art = 'entlassung' \
           AND quelle = 'disposition' AND zeitpunkt_at = ? AND ursprung_id IS NULL \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .bind(entlassen_at)
    .fetch_optional(&mut *conn)
    .await?;
    // Mit der Entlassung: alles nach ihr erfasste zählt. Ohne sie: was nach dem Entlassen erfasst
    // ist (in derselben Sekunde stünde auch ein Statuswechsel kurz davor).
    let berichtigt: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM einsatz_kraft_zeitachse \
                       WHERE personal_id = ?1 \
                         AND (gestrichen_at > ?2 \
                              OR (?3 IS NOT NULL AND id > ?3) \
                              OR (?3 IS NULL AND erfasst_at > ?2)))",
    )
    .bind(ep_id)
    .bind(entlassen_at)
    .bind(ereignis)
    .fetch_one(&mut *conn)
    .await?;
    if berichtigt {
        return Err(zeitachse_conflict());
    }
    Ok(ereignis)
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
        Some(_) if !rechte.einheiten => ergebnis
            .ausgelassen
            .push(aus("Einheit".into(), OHNE_RECHT_EINHEITEN)),
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

/// Die Führung kommt nur in der Einheit zurück, der die Person jetzt (wieder) angehört: der Führer
/// ist Mitglied (`einheit::repo::check_fuehrer`). Eine Einheit, die es nicht mehr gibt, nennt eine
/// Zeile ohne Namen. Zwei Anweisungen, gleich wie lang die Liste ist (`src/AGENTS.md`,
/// „Eingabegrenzen“).
async fn bind_fuehrung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    benutzer_id: i64,
    einheiten: &[i64],
    rechte: RuecknahmeRechte,
    ergebnis: &mut Ruecknahme,
) -> Result<(), AppError> {
    let ids = crate::kraefte_disposition::ids_json(einheiten);
    if rechte.einheiten {
        let gebunden: Vec<i64> = sqlx::query_scalar(
            "UPDATE einsatz_einheit SET fuehrer_id = ?1 \
             WHERE einsatz_id = ?2 AND id IN (SELECT value FROM json_each(?3)) \
               AND fuehrer_id IS NULL AND aufgeloest_at IS NULL \
               AND id = (SELECT einheit_id FROM einsatz_personal WHERE id = ?1) \
             RETURNING id",
        )
        .bind(ep_id)
        .bind(einsatz_id)
        .bind(&ids)
        .fetch_all(&mut *conn)
        .await?;
        for id in gebunden {
            // Änderungsvermerk am Führer (Spec `aenderungsvermerk`, „bei jedem Schreiben“).
            crate::einsatz::feld_vermerk::setze_tx(
                conn,
                einsatz_id,
                crate::einsatz::feld_vermerk::Objekt::Einheit(id),
                &["fuehrer_id"],
                benutzer_id,
            )
            .await?;
            merke_einheit(ergebnis, id);
        }
    }
    let fehlen: Vec<(String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT name, aufgeloest_at, fuehrer_id FROM einsatz_einheit \
         WHERE einsatz_id = ?1 AND id IN (SELECT value FROM json_each(?2)) \
           AND fuehrer_id IS NOT ?3 ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(&ids)
    .bind(ep_id)
    .fetch_all(&mut *conn)
    .await?;
    if !rechte.einheiten {
        if !fehlen.is_empty() {
            ergebnis.ausgelassen.push(RuecknahmeAusgelassen::new(
                "Führung einer Einheit",
                OHNE_RECHT_EINHEITEN,
            ));
        }
        return Ok(());
    }
    let vorhanden: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_einheit \
         WHERE einsatz_id = ?1 AND id IN (SELECT value FROM json_each(?2))",
    )
    .bind(einsatz_id)
    .bind(&ids)
    .fetch_one(&mut *conn)
    .await?;
    if (vorhanden as usize) < einheiten.len() {
        ergebnis.ausgelassen.push(RuecknahmeAusgelassen::new(
            "Führung einer Einheit",
            "inzwischen aufgelöst",
        ));
    }
    for (name, aufgeloest_at, fuehrer) in fehlen {
        let grund = if aufgeloest_at.is_some() {
            "inzwischen aufgelöst"
        } else if fuehrer.is_some() {
            "inzwischen anders besetzt"
        } else {
            "nicht mehr Mitglied der Einheit"
        };
        ergebnis.ausgelassen.push(RuecknahmeAusgelassen::new(
            format!("Führung von «{name}»"),
            grund,
        ));
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
        Some(_) if !rechte.fahrzeuge => ergebnis.ausgelassen.push(aus(
            "Fahrzeug".into(),
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
        Some(_) if !rechte.unfallhilfsstellen => ergebnis.ausgelassen.push(aus(
            "UHS".into(),
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

/// Wie [`bind_fuehrung_tx`]: eine feste Zahl von Anweisungen für die ganze Liste. Abschnitte, die
/// es nicht mehr gibt (ein Abschnitt wird beim Auflösen gelöscht), nennt eine Zeile mit ihrer
/// Zahl, ohne Namen: ohne gespeicherten Vorzustand ließen sie sich nicht von erfundenen Kennungen
/// unterscheiden.
async fn bind_abschnitte_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    abschnitte: &[i64],
    rechte: RuecknahmeRechte,
    ergebnis: &mut Ruecknahme,
) -> Result<(), AppError> {
    let ids = crate::kraefte_disposition::ids_json(abschnitte);
    if rechte.einsatzabschnitte {
        ergebnis.abschnitte = sqlx::query_scalar(
            "UPDATE einsatzabschnitt SET leiter_id = ?1 \
             WHERE einsatz_id = ?2 AND id IN (SELECT value FROM json_each(?3)) \
               AND leiter_id IS NULL RETURNING id",
        )
        .bind(ep_id)
        .bind(einsatz_id)
        .bind(&ids)
        .fetch_all(&mut *conn)
        .await?;
        ergebnis.abschnitte.sort_unstable();
    }
    let fehlen: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM einsatzabschnitt \
         WHERE einsatz_id = ?1 AND id IN (SELECT value FROM json_each(?2)) \
           AND leiter_id IS NOT ?3 ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(&ids)
    .bind(ep_id)
    .fetch_all(&mut *conn)
    .await?;
    if !rechte.einsatzabschnitte {
        if !fehlen.is_empty() {
            ergebnis.ausgelassen.push(RuecknahmeAusgelassen::new(
                "Leitung eines Abschnitts",
                "kein Schreibrecht im Modul Einsatzabschnitte",
            ));
        }
        return Ok(());
    }
    for name in fehlen {
        ergebnis.ausgelassen.push(RuecknahmeAusgelassen::new(
            format!("Leitung von «{name}»"),
            "inzwischen anders besetzt",
        ));
    }
    let vorhanden: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatzabschnitt \
         WHERE einsatz_id = ?1 AND id IN (SELECT value FROM json_each(?2))",
    )
    .bind(einsatz_id)
    .bind(&ids)
    .fetch_one(&mut *conn)
    .await?;
    let fort = abschnitte.len().saturating_sub(vorhanden as usize);
    if fort > 0 {
        let bezeichnung = if fort == 1 {
            "Leitung eines Abschnitts".to_string()
        } else {
            format!("Leitung von {fort} Abschnitten")
        };
        ergebnis.ausgelassen.push(RuecknahmeAusgelassen::new(
            bezeichnung,
            "nicht mehr vorhanden",
        ));
    }
    Ok(())
}

/// Die Einsatzleitung kommt nur zurück, wenn kein anderer Einsatzleiter eingetragen ist
/// (design.md D5): die Zeile trägt noch den Vermerk „nicht mehr disponiert“ dieser Person (Art
/// `personal`, ohne Verweis, der eingefrorene Name aus dem Vorzustand). Name und „seit“ bleiben,
/// wie sie waren.
async fn bind_einsatzleitung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    benutzer_id: i64,
    einsatzleiter_name: &str,
    ergebnis: &mut Ruecknahme,
) -> Result<(), AppError> {
    let r = sqlx::query(
        "UPDATE einsatz_fuehrungsstelle SET einsatzleiter_personal_id = ? \
         WHERE einsatz_id = ? AND einsatzleiter_art = 'personal' \
           AND einsatzleiter_personal_id IS NULL AND einsatzleiter_name = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .bind(einsatzleiter_name)
    .execute(&mut *conn)
    .await?;
    if r.rows_affected() == 1 {
        crate::einsatz::feld_vermerk::setze_tx(
            conn,
            einsatz_id,
            crate::einsatz::feld_vermerk::Objekt::Fuehrungsstelle,
            &["einsatzleiter"],
            benutzer_id,
        )
        .await?;
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
