use super::{AufenthaltAnzeige, BelegungAnzeige};
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, person_id, uhs_id, platz_id, art, notiz, zeitpunkt_at, erfasst_von, \
           ruecknahme_von \
    FROM person_uhs_belegung";

/// Was beim Auto-Austritt passiert ist (für ETB-Text und SSE im Wrapper).
#[derive(Debug, Clone)]
pub struct AustrittInfo {
    pub uhs_id: i64,
    pub platz_id: Option<i64>,
    pub event_id: i64,
}

/// Eintritt einer Person in eine UHS. Die UHS muss `aktiv` sein, die Person noch nicht belegt;
/// mit Platz gilt die Verfügbarkeits-Regel. Inbox-Eintritt = `platz_id = None`. Event,
/// Cache-Update und ggf. Reservierungs-Einlösung in EINER Transaktion.
pub async fn eintritt(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    uhs_id: i64,
    platz_id: Option<i64>,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<BelegungAnzeige, AppError> {
    let id = crate::write_retry!(pool, |conn| {
        eintritt_tx(
            conn,
            einsatz_id,
            person_id,
            uhs_id,
            platz_id,
            notiz,
            erfasst_von,
            None,
        )
        .await
    })?;
    laden(pool, einsatz_id, id).await
}

/// Eintritt auf der Transaktion des Aufrufers: bei der Aufnahme gehören Person, Sichtung,
/// Belegung und Audit zusammen. Kein eigener Commit, kein Pool-Read.
///
/// `zeitpunkt_at` ist die Erfassungszeit einer ohne Netz vorgemerkten Aufnahme (LLH-1515), vom
/// Aufrufer schon gekappt; `None` = jetzt. Nur für eine im selben Schritt angelegte Person: sie
/// hat noch kein Belegungsereignis, vor das der Eintritt rutschen könnte.
#[allow(clippy::too_many_arguments)]
pub async fn eintritt_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    uhs_id: i64,
    platz_id: Option<i64>,
    notiz: Option<&str>,
    erfasst_von: i64,
    zeitpunkt_at: Option<&str>,
) -> Result<i64, AppError> {
    pruefe_uhs_aktiv(&mut *conn, einsatz_id, uhs_id).await?;
    pruefe_person_nicht_belegt(&mut *conn, einsatz_id, person_id).await?;
    if let Some(pid) = platz_id {
        pruefe_platz_belegbar(&mut *conn, uhs_id, pid, person_id).await?;
    }
    let id = insert_event(
        &mut *conn,
        einsatz_id,
        person_id,
        uhs_id,
        platz_id,
        "eintritt",
        notiz,
        erfasst_von,
        zeitpunkt_at,
    )
    .await?;
    update_cache(&mut *conn, einsatz_id, person_id, Some(uhs_id), platz_id).await?;
    if let Some(pid) = platz_id {
        loese_eigene_reservierung_ein(&mut *conn, pid, person_id).await?;
    }
    Ok(id)
}

/// UHS-/Platz-Wechsel einer Person mit aktiver Belegung. Die Ziel-UHS muss `aktiv` sein, mit
/// Ziel-Platz gilt die Verfügbarkeits-Regel. Der bisherige Platz wird vorher auto-aufbereitet
/// (nur, wenn er `frei` war). Alles in EINER Transaktion.
pub async fn wechsel(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    ziel_uhs_id: i64,
    ziel_platz_id: Option<i64>,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<BelegungAnzeige, AppError> {
    let id = crate::write_retry!(pool, |conn| {
        pruefe_uhs_aktiv(&mut *conn, einsatz_id, ziel_uhs_id).await?;
        let (ex_uhs, ex_platz) = lade_cache(&mut *conn, person_id).await?;
        if ex_uhs.is_none() {
            return Err(AppError::Conflict(
                "Person hat keine aktive Belegung".into(),
            ));
        }
        if let Some(zpid) = ziel_platz_id {
            pruefe_platz_belegbar(&mut *conn, ziel_uhs_id, zpid, person_id).await?;
        }
        let id = insert_event(
            &mut *conn,
            einsatz_id,
            person_id,
            ziel_uhs_id,
            ziel_platz_id,
            "wechsel",
            notiz,
            erfasst_von,
            None,
        )
        .await?;
        // Cache erst nach Aufbereitung umsetzen, sonst greift der Belegungs-Check beim Ex-Platz nicht.
        if let Some(ex_pid) = ex_platz {
            auto_aufbereitung_wenn_frei(&mut *conn, ex_pid).await?;
        }
        update_cache(
            &mut *conn,
            einsatz_id,
            person_id,
            Some(ziel_uhs_id),
            ziel_platz_id,
        )
        .await?;
        if let Some(zpid) = ziel_platz_id {
            loese_eigene_reservierung_ein(&mut *conn, zpid, person_id).await?;
        }
        Ok(id)
    })?;
    laden(pool, einsatz_id, id).await
}

/// Manueller Austritt bei aktiver Belegung: Event, Cache leeren, Ex-Platz auto-aufbereiten
/// (falls vorher frei). Alles in EINER Transaktion.
pub async fn austritt(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<BelegungAnzeige, AppError> {
    let id = crate::write_retry!(pool, |conn| {
        let (ex_uhs, ex_platz) = lade_cache(&mut *conn, person_id).await?;
        let uhs =
            ex_uhs.ok_or_else(|| AppError::Conflict("Person hat keine aktive Belegung".into()))?;
        let id = insert_event(
            &mut *conn,
            einsatz_id,
            person_id,
            uhs,
            None,
            "austritt",
            notiz,
            erfasst_von,
            None,
        )
        .await?;
        if let Some(ex_pid) = ex_platz {
            auto_aufbereitung_wenn_frei(&mut *conn, ex_pid).await?;
        }
        update_cache(&mut *conn, einsatz_id, person_id, None, None).await?;
        Ok(id)
    })?;
    laden(pool, einsatz_id, id).await
}

/// Wie lange ein Austritt zurückgenommen werden kann (LLH-1924, design.md D3), wie am
/// Bereitstellungsraum.
pub const RUECKNAHME_FENSTER_MIN: i64 = 10;

/// Ergebnis einer Rücknahme: das neue Ereignis und ob die Person ihren Platz davor nicht
/// zurückbekam und im Wartebereich steht.
#[derive(Debug, Clone)]
pub struct Ruecknahme {
    pub ereignis: BelegungAnzeige,
    pub ohne_platz: bool,
}

/// Nimmt den Austritt einer Person aus einer UHS zurück (LLH-1924, Spec `personen-detail`,
/// „Austritt aus der UHS zurücknehmen“, design.md D2/D3): ein Eintritt in dieselbe UHS mit
/// `ruecknahme_von`. Den Platz davor bekommt sie zurück, wenn er frei ist oder in Aufbereitung
/// steht und seither niemand auf ihm lag; sonst kommt sie in den Wartebereich.
///
/// # Regeln (in Reihenfolge, jede Ablehnung schreibt nichts)
/// 1. Das Ereignis ist ein Austritt dieser Person in diesem Einsatz → sonst `NotFound`
/// 1a. Er trägt keinen Anlass (Notiz eines automatischen Austritts) → `Conflict`
/// 2. Er ist noch nicht zurückgenommen → `Conflict`
/// 3. Er ist das jüngste Ereignis der Person → `Conflict`
/// 4. Er ist höchstens [`RUECKNAHME_FENSTER_MIN`] Minuten alt → `Conflict`
/// 5. UHS aktiv (`UnprocessableEntity`), Person nicht belegt und nicht storniert (`Conflict`)
pub async fn nimm_austritt_zurueck(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    austritt_id: i64,
    erfasst_von: i64,
) -> Result<Ruecknahme, AppError> {
    let (id, ohne_platz) = crate::write_retry!(pool, |conn| {
        nimm_austritt_zurueck_tx(conn, einsatz_id, person_id, austritt_id, erfasst_von).await
    })?;
    Ok(Ruecknahme {
        ereignis: laden(pool, einsatz_id, id).await?,
        ohne_platz,
    })
}

async fn nimm_austritt_zurueck_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    austritt_id: i64,
    erfasst_von: i64,
) -> Result<(i64, bool), AppError> {
    let zeile: Option<(i64, bool, bool)> = sqlx::query_as(
        "SELECT uhs_id, zeitpunkt_at >= strftime('%Y-%m-%d %H:%M:%S', 'now', ?) AS frisch, \
                notiz IS NOT NULL AS mit_anlass \
         FROM person_uhs_belegung \
         WHERE id = ? AND einsatz_id = ? AND person_id = ? AND art = 'austritt'",
    )
    .bind(format!("-{RUECKNAHME_FENSTER_MIN} minutes"))
    .bind(austritt_id)
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (uhs_id, frisch, mit_anlass) = zeile.ok_or(AppError::NotFound)?;
    // Ein automatischer Austritt (Verbleib, Status, Storno) trägt seinen Anlass; zurückgenommen
    // wird nur das Austragen von Hand (Review LLH-1924).
    if mit_anlass {
        return Err(AppError::Conflict(
            "Dieser Austritt hat einen eigenen Anlass und lässt sich nicht zurücknehmen".into(),
        ));
    }
    let schon: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM person_uhs_belegung WHERE ruecknahme_von = ?)",
    )
    .bind(austritt_id)
    .fetch_one(&mut *conn)
    .await?;
    if schon {
        return Err(AppError::Conflict(
            "Das Austragen ist schon zurückgenommen".into(),
        ));
    }
    let (juengste, platz_davor): (i64, Option<i64>) = sqlx::query_as(
        "SELECT (SELECT MAX(id) FROM person_uhs_belegung WHERE person_id = ?1 AND einsatz_id = ?2), \
                (SELECT platz_id FROM person_uhs_belegung \
                  WHERE person_id = ?1 AND einsatz_id = ?2 AND id < ?3 AND uhs_id = ?4 \
                  ORDER BY id DESC LIMIT 1)",
    )
    .bind(person_id)
    .bind(einsatz_id)
    .bind(austritt_id)
    .bind(uhs_id)
    .fetch_one(&mut *conn)
    .await?;
    if juengste != austritt_id {
        return Err(AppError::Conflict(
            "Die Person ist inzwischen weiter gebucht".into(),
        ));
    }
    if !frisch {
        return Err(AppError::Conflict(format!(
            "Das Austragen liegt mehr als {RUECKNAHME_FENSTER_MIN} Minuten zurück"
        )));
    }
    pruefe_uhs_aktiv(&mut *conn, einsatz_id, uhs_id).await?;
    pruefe_person_nicht_belegt(&mut *conn, einsatz_id, person_id).await?;
    let platz = match platz_davor {
        Some(pid) => platz_wieder_frei_tx(&mut *conn, uhs_id, pid, austritt_id).await?,
        None => None,
    };
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO person_uhs_belegung \
            (einsatz_id, person_id, uhs_id, platz_id, art, erfasst_von, ruecknahme_von) \
         VALUES (?, ?, ?, ?, 'eintritt', ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(uhs_id)
    .bind(platz)
    .bind(erfasst_von)
    .bind(austritt_id)
    .fetch_one(&mut *conn)
    .await?;
    update_cache(&mut *conn, einsatz_id, person_id, Some(uhs_id), platz).await?;
    Ok((id, platz_davor.is_some() && platz.is_none()))
}

/// Der Platz davor, wenn die Rücknahme ihn wieder nehmen darf (design.md D3): nicht storniert,
/// frei oder in Aufbereitung, niemand liegt darauf und seit dem Austritt hat kein Ereignis ihn
/// genannt. Eine Aufbereitung geht dabei zurück auf frei, wie vor dem Austritt.
async fn platz_wieder_frei_tx(
    conn: &mut SqliteConnection,
    uhs_id: i64,
    platz_id: i64,
    austritt_id: i64,
) -> Result<Option<i64>, AppError> {
    let frei: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM uhs_platz p \
           WHERE p.id = ?1 AND p.uhs_id = ?2 AND p.storniert_at IS NULL \
             AND p.verfuegbarkeit IN ('frei', 'aufbereitung') \
             AND NOT EXISTS (SELECT 1 FROM einsatz_person ep WHERE ep.aktueller_platz_id = p.id) \
             AND NOT EXISTS (SELECT 1 FROM person_uhs_belegung b \
                              WHERE b.platz_id = p.id AND b.id > ?3))",
    )
    .bind(platz_id)
    .bind(uhs_id)
    .bind(austritt_id)
    .fetch_one(&mut *conn)
    .await?;
    if !frei {
        return Ok(None);
    }
    sqlx::query("UPDATE uhs_platz SET verfuegbarkeit = 'frei' WHERE id = ? AND verfuegbarkeit = 'aufbereitung'")
        .bind(platz_id)
        .execute(&mut *conn)
        .await?;
    Ok(Some(platz_id))
}

/// Auto-Austritt für Cross-Modul-Hooks (Personenstatus, Verbleib, Storno), in EINER
/// Transaktion: (a) ist die Person belegt → Austritt-Event, Cache-Cleanup, Auto-Aufbereitung;
/// (b) IMMER → Reservierungen mit `reserviert_fuer_person_id = person_id` auflösen.
///
/// `Some(AustrittInfo)` nur, wenn ein Austritt-Event geschrieben wurde (für ETB-Text und SSE im
/// Wrapper); bei `None` kann trotzdem ein Reservierungs-Cleanup gelaufen sein.
pub async fn austritt_intern(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<Option<AustrittInfo>, AppError> {
    crate::write_retry!(pool, |conn| {
        austritt_intern_tx(conn, einsatz_id, person_id, notiz, erfasst_von).await
    })
}

/// Ob die Person nach `zeitpunkt_at` in eine UHS eingetreten oder gewechselt ist (LLH-1138,
/// Spec `personen-verlauf`): ein nachgereichter Verbleib, der älter ist als dieser Zugang, nimmt
/// sie nicht mehr aus der UHS. Gleicher Zeitpunkt zählt nicht als später (der Verbleib ist
/// später gespeichert und gewinnt). Die Rücknahme eines Austritts ist kein Zugang (LLH-1924).
pub async fn has_zugang_nach_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    zeitpunkt_at: &str,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM person_uhs_belegung \
                       WHERE einsatz_id = ? AND person_id = ? AND art IN ('eintritt','wechsel') \
                         AND ruecknahme_von IS NULL \
                         AND datetime(zeitpunkt_at) > datetime(?))",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(zeitpunkt_at)
    .fetch_one(&mut *conn)
    .await?)
}

/// [`austritt_intern`] in einer laufenden Transaktion, etwa im selben Schritt wie der
/// auslösende Verbleib (LLH-1138, design.md D5): der Austritt läuft dann nur, wenn der neue
/// Verbleib gewinnt.
pub async fn austritt_intern_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<Option<AustrittInfo>, AppError> {
    austritt_zum_tx(conn, einsatz_id, person_id, notiz, erfasst_von, None).await
}

/// [`austritt_intern_tx`] zu einer Erfassungszeit (`None` = jetzt): ein ohne Netz vorgemerkter
/// leichter Fall (LLH-1572, design.md D6) tritt zu derselben Zeit aus, zu der er eintrat, statt
/// erst bei der Übertragung.
pub async fn austritt_zum_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    notiz: Option<&str>,
    erfasst_von: i64,
    zeitpunkt_at: Option<&str>,
) -> Result<Option<AustrittInfo>, AppError> {
    {
        let (ex_uhs, ex_platz) = lade_cache(&mut *conn, person_id).await?;
        // Reservierungs-Cleanup IMMER (bei Storno, Status verstorben/abgemeldet):
        sqlx::query(
            "UPDATE uhs_platz SET verfuegbarkeit = 'frei', reserviert_fuer_person_id = NULL \
             WHERE reserviert_fuer_person_id = ?",
        )
        .bind(person_id)
        .execute(&mut *conn)
        .await?;
        let info = if let Some(uhs) = ex_uhs {
            let id = insert_event(
                &mut *conn,
                einsatz_id,
                person_id,
                uhs,
                None,
                "austritt",
                notiz,
                erfasst_von,
                zeitpunkt_at,
            )
            .await?;
            if let Some(ex_pid) = ex_platz {
                auto_aufbereitung_wenn_frei(&mut *conn, ex_pid).await?;
            }
            update_cache(&mut *conn, einsatz_id, person_id, None, None).await?;
            Some(AustrittInfo {
                uhs_id: uhs,
                platz_id: ex_platz,
                event_id: id,
            })
        } else {
            None
        };
        Ok(info)
    }
}

/// Belegungs-Verlauf einer UHS (neueste zuerst).
pub async fn liste_je_uhs(
    pool: &SqlitePool,
    uhs_id: i64,
) -> Result<Vec<BelegungAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, BelegungAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_ALLE} WHERE uhs_id = ? ORDER BY zeitpunkt_at DESC, id DESC"
        )))
        .bind(uhs_id)
        .fetch_all(pool)
        .await?,
    )
}

/// Belegungs-Verlauf einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<BelegungAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, BelegungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? AND person_id = ? ORDER BY zeitpunkt_at DESC, id DESC"
    )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
}

/// Der aktuelle Aufenthalt einer Person aus dem Cache an `einsatz_person` (LLH-1129); `None`
/// außerhalb jeder UHS. Ein Read, für das Personen-Detail.
pub async fn aufenthalt(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Option<AufenthaltAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, AufenthaltAnzeige>(
        "SELECT u.id AS uhs_id, u.bezeichnung AS uhs_bezeichnung, \
                pl.id AS platz_id, pl.bezeichnung AS platz_bezeichnung, \
                (SELECT b.zeitpunkt_at FROM person_uhs_belegung b \
                  WHERE b.person_id = ep.id AND b.uhs_id = ep.aktuelle_uhs_id \
                    AND b.art <> 'austritt' AND b.ruecknahme_von IS NULL \
                  ORDER BY b.zeitpunkt_at DESC, b.id DESC LIMIT 1) AS seit \
         FROM einsatz_person ep \
         JOIN uhs u ON u.id = ep.aktuelle_uhs_id \
         LEFT JOIN uhs_platz pl ON pl.id = ep.aktueller_platz_id \
         WHERE ep.einsatz_id = ? AND ep.id = ?",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_optional(pool)
    .await?)
}

/// Lädt ein einzelnes Event; `NotFound` außerhalb des Einsatzes.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<BelegungAnzeige, AppError> {
    sqlx::query_as::<_, BelegungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

// ---------------------------- private Helpers ----------------------------

async fn pruefe_uhs_aktiv(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<(), AppError> {
    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM uhs WHERE id = ? AND einsatz_id = ? AND storniert_at IS NULL",
    )
    .bind(uhs_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    match status.as_deref() {
        Some("aktiv") => Ok(()),
        Some(other) => Err(AppError::UnprocessableEntity(format!(
            "UHS hat Status '{other}' — Belegung nur bei aktiver UHS möglich"
        ))),
        None => Err(AppError::NotFound),
    }
}

async fn pruefe_person_nicht_belegt(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
) -> Result<(), AppError> {
    let cache: Option<(Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT aktuelle_uhs_id, storniert_at FROM einsatz_person WHERE id = ? AND einsatz_id = ?",
    )
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (uhs, storno) = cache.ok_or(AppError::NotFound)?;
    if storno.is_some() {
        return Err(AppError::Conflict("Person ist storniert".into()));
    }
    if uhs.is_some() {
        return Err(AppError::Conflict(
            "Person hat bereits eine aktive Belegung — Wechsel oder Austritt verwenden".into(),
        ));
    }
    Ok(())
}

async fn pruefe_platz_belegbar(
    conn: &mut SqliteConnection,
    uhs_id: i64,
    platz_id: i64,
    person_id: i64,
) -> Result<(), AppError> {
    let row: Option<(i64, String, Option<i64>)> = sqlx::query_as(
        "SELECT uhs_id, verfuegbarkeit, reserviert_fuer_person_id \
         FROM uhs_platz WHERE id = ? AND storniert_at IS NULL",
    )
    .bind(platz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (platz_uhs, verf, res_fuer) = row.ok_or(AppError::NotFound)?;
    if platz_uhs != uhs_id {
        return Err(AppError::Validation(
            "Platz gehört nicht zu dieser UHS".into(),
        ));
    }
    match verf.as_str() {
        "frei" => Ok(()),
        "reserviert" if res_fuer == Some(person_id) => Ok(()),
        other => Err(AppError::UnprocessableEntity(format!(
            "Platz nicht belegbar (Verfügbarkeit: {other})"
        ))),
    }
}

async fn lade_cache(
    conn: &mut SqliteConnection,
    person_id: i64,
) -> Result<(Option<i64>, Option<i64>), AppError> {
    sqlx::query_as("SELECT aktuelle_uhs_id, aktueller_platz_id FROM einsatz_person WHERE id = ?")
        .bind(person_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
}

/// `zeitpunkt_at` `None` = jetzt, im Format der Spaltenvorgabe (Migration 0029).
#[allow(clippy::too_many_arguments)]
async fn insert_event(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    uhs_id: i64,
    platz_id: Option<i64>,
    art: &str,
    notiz: Option<&str>,
    erfasst_von: i64,
    zeitpunkt_at: Option<&str>,
) -> Result<i64, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO person_uhs_belegung \
            (einsatz_id, person_id, uhs_id, platz_id, art, notiz, erfasst_von, zeitpunkt_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%d %H:%M:%S','now'))) \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(uhs_id)
    .bind(platz_id)
    .bind(art)
    .bind(notiz)
    .bind(erfasst_von)
    .bind(zeitpunkt_at)
    .fetch_one(&mut *conn)
    .await;
    match ergebnis {
        Ok(id) => Ok(id),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            Err(AppError::Conflict("Platz ist bereits belegt".into()))
        }
        Err(e) => Err(e.into()),
    }
}

async fn update_cache(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    uhs_id: Option<i64>,
    platz_id: Option<i64>,
) -> Result<(), AppError> {
    // Beim Setzen des Caches kann der partielle Unique-Index zuschlagen (eine andere Person hält
    // den Platz) → Konflikt.
    let ergebnis = sqlx::query(
        "UPDATE einsatz_person SET aktuelle_uhs_id = ?, aktueller_platz_id = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(uhs_id)
    .bind(platz_id)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await;
    match ergebnis {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            Err(AppError::Conflict("Platz ist bereits belegt".into()))
        }
        Err(e) => Err(e.into()),
    }
}

async fn auto_aufbereitung_wenn_frei(
    conn: &mut SqliteConnection,
    platz_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE uhs_platz SET verfuegbarkeit = 'aufbereitung' \
         WHERE id = ? AND verfuegbarkeit = 'frei'",
    )
    .bind(platz_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn loese_eigene_reservierung_ein(
    conn: &mut SqliteConnection,
    platz_id: i64,
    person_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE uhs_platz SET verfuegbarkeit = 'frei', reserviert_fuer_person_id = NULL \
         WHERE id = ? AND verfuegbarkeit = 'reserviert' AND reserviert_fuer_person_id = ?",
    )
    .bind(platz_id)
    .bind(person_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use crate::uhs::{platz_repo, repo as uhs_repo, BelegungsArt};
    use sqlx::SqlitePool;

    /// Liefert (benutzer, einsatz, uhs_aktiv, uhs_geplant, platz_a_in_aktiv, platz_b_in_aktiv, person).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64, i64, i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let u_aktiv = uhs_repo::anlegen(
            pool,
            e,
            b,
            uhs_repo::NeueDaten {
                lat: None,
                lon: None,
                typ: "behandlungsplatz",
                bezeichnung: "BHP 50",
                abschnitt_id: None,
                standort: None,
                notiz: None,
            },
        )
        .await
        .unwrap();
        uhs_repo::setze_status(pool, e, u_aktiv.id, "aktiv", b)
            .await
            .unwrap();
        let u_geplant = uhs_repo::anlegen(
            pool,
            e,
            b,
            uhs_repo::NeueDaten {
                lat: None,
                lon: None,
                typ: "patientenablage",
                bezeichnung: "PA 1",
                abschnitt_id: None,
                standort: None,
                notiz: None,
            },
        )
        .await
        .unwrap();
        let pa = platz_repo::anlegen(
            pool,
            u_aktiv.id,
            platz_repo::NeuerPlatz {
                typ: "bett",
                bezeichnung: "Bett 3",
                pos_x: None,
                pos_y: None,
            },
        )
        .await
        .unwrap();
        let pb = platz_repo::anlegen(
            pool,
            u_aktiv.id,
            platz_repo::NeuerPlatz {
                typ: "bett",
                bezeichnung: "Bett 5",
                pos_x: None,
                pos_y: None,
            },
        )
        .await
        .unwrap();
        let person: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(pool).await.unwrap();
        (b, e, u_aktiv.id, u_geplant.id, pa.id, pb.id, person)
    }

    async fn cache(pool: &SqlitePool, person: i64) -> (Option<i64>, Option<i64>) {
        sqlx::query_as(
            "SELECT aktuelle_uhs_id, aktueller_platz_id FROM einsatz_person WHERE id = ?",
        )
        .bind(person)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn verfuegbarkeit(pool: &SqlitePool, platz: i64) -> String {
        sqlx::query_scalar("SELECT verfuegbarkeit FROM uhs_platz WHERE id = ?")
            .bind(platz)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn eintritt_inbox_setzt_cache_uhs_und_platz_null() {
        let pool = test_pool().await;
        let (b, e, u, _, _, _, p) = setup(&pool).await;
        let ev = eintritt(&pool, e, p, u, None, None, b).await.unwrap();
        assert_eq!(ev.art, BelegungsArt::Eintritt);
        assert!(ev.platz_id.is_none());
        assert_eq!(cache(&pool, p).await, (Some(u), None));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn eintritt_unter_konkurrierendem_writer_ist_ok() {
        // `eintritt` (read-then-write) darf unter einem kurz konkurrierenden Writer nicht mit
        // SQLITE_BUSY scheitern: unter `BEGIN IMMEDIATE` wartet es am BEGIN, bis Writer B
        // committet.
        // Braucht das Datei/WAL-Harness.
        let (_dir, pool) = crate::db::test_pool_datei().await;
        let (b, e, u, _, _, _, p) = setup(&pool).await;

        // Writer B hält den WAL-Write-Lock für ~200ms.
        let mut tx_b = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        sqlx::query("UPDATE organisation SET name = 'gehalten' WHERE id = 1")
            .execute(&mut *tx_b)
            .await
            .unwrap();

        // A: das echte eintritt nebenläufig starten.
        let pool_a = pool.clone();
        let handle = tokio::spawn(async move { eintritt(&pool_a, e, p, u, None, None, b).await });

        // A erreicht (deferred) seine SELECT-Guards und blockt am ersten Write.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        tx_b.commit().await.unwrap();

        let res = handle.await.unwrap();
        assert!(
            res.is_ok(),
            "eintritt muss unter kurz konkurrierendem Writer gelingen \
             (BEGIN IMMEDIATE + busy_timeout), war: {res:?}"
        );
    }

    #[tokio::test]
    async fn eintritt_platz_belegt_cache_und_unique_index() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        assert_eq!(cache(&pool, p).await, (Some(u), Some(pa)));
        // Zweite Person auf denselben Platz → Unique-Index-Verletzung:
        let p2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        let err = eintritt(&pool, e, p2, u, Some(pa), None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "1:1-Belegung erzwungen"
        );
    }

    #[tokio::test]
    async fn inbox_mehrfach_belegung_erlaubt() {
        let pool = test_pool().await;
        let (b, e, u, _, _, _, p1) = setup(&pool).await;
        let p2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        eintritt(&pool, e, p1, u, None, None, b).await.unwrap();
        eintritt(&pool, e, p2, u, None, None, b).await.unwrap();
        // Beide in Inbox derselben UHS:
        assert_eq!(cache(&pool, p1).await, (Some(u), None));
        assert_eq!(cache(&pool, p2).await, (Some(u), None));
    }

    #[tokio::test]
    async fn eintritt_in_geplante_uhs_ist_422() {
        let pool = test_pool().await;
        let (b, e, _, ug, _, _, p) = setup(&pool).await;
        let err = eintritt(&pool, e, p, ug, None, None, b).await.unwrap_err();
        assert!(
            matches!(err, AppError::UnprocessableEntity(_)),
            "geplante UHS akzeptiert keine Belegung"
        );
    }

    #[tokio::test]
    async fn eintritt_doppelt_ohne_austritt_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e, u, _, _, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, None, None, b).await.unwrap();
        let err = eintritt(&pool, e, p, u, None, None, b).await.unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Eintritt während aktiver Belegung"
        );
    }

    #[tokio::test]
    async fn eintritt_auf_defekten_platz_ist_422() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        platz_repo::setze_verfuegbarkeit(&pool, u, pa, "defekt", None)
            .await
            .unwrap();
        let err = eintritt(&pool, e, p, u, Some(pa), None, b)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)));
    }

    #[tokio::test]
    async fn eintritt_auf_eigene_reservierung_loest_sie_ein() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        platz_repo::setze_verfuegbarkeit(&pool, u, pa, "reserviert", Some(p))
            .await
            .unwrap();
        eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        assert_eq!(
            verfuegbarkeit(&pool, pa).await,
            "frei",
            "Reservierung wird durch Belegung eingelöst"
        );
        let fk: Option<i64> =
            sqlx::query_scalar("SELECT reserviert_fuer_person_id FROM uhs_platz WHERE id = ?")
                .bind(pa)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(fk.is_none());
    }

    #[tokio::test]
    async fn eintritt_auf_fremd_reservierten_platz_ist_422() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        let andere: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        platz_repo::setze_verfuegbarkeit(&pool, u, pa, "reserviert", Some(andere))
            .await
            .unwrap();
        let err = eintritt(&pool, e, p, u, Some(pa), None, b)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)));
    }

    #[tokio::test]
    async fn wechsel_in_andere_uhs_setzt_cache_um_und_aufbereitung_alter_platz() {
        let pool = test_pool().await;
        let (b, e, u, ug, pa, _, p) = setup(&pool).await;
        // Ziel-UHS aktivieren:
        uhs_repo::setze_status(&pool, e, ug, "aktiv", b)
            .await
            .unwrap();
        let pinbox = u; // Start in Inbox von u
        eintritt(&pool, e, p, pinbox, None, None, b).await.unwrap();
        // Erst Platz a belegen, dann wechseln nach ug-Inbox:
        wechsel(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        assert_eq!(cache(&pool, p).await, (Some(u), Some(pa)));
        wechsel(&pool, e, p, ug, None, None, b).await.unwrap();
        assert_eq!(cache(&pool, p).await, (Some(ug), None));
        assert_eq!(
            verfuegbarkeit(&pool, pa).await,
            "aufbereitung",
            "Verlassen eines frei-Platzes → Auto-Aufbereitung"
        );
    }

    #[tokio::test]
    async fn austritt_setzt_cache_null_und_aufbereitet_ex_platz() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        austritt(&pool, e, p, None, b).await.unwrap();
        assert_eq!(cache(&pool, p).await, (None, None));
        assert_eq!(verfuegbarkeit(&pool, pa).await, "aufbereitung");
    }

    async fn alt_machen(pool: &SqlitePool, ereignis: i64, at: &str) {
        sqlx::query("UPDATE person_uhs_belegung SET zeitpunkt_at = ? WHERE id = ?")
            .bind(at)
            .bind(ereignis)
            .execute(pool)
            .await
            .unwrap();
    }

    /// LLH-1924: Rücknahme bringt die Person auf ihren Platz zurück, der Platz verlässt die
    /// Aufbereitung, `seit` bleibt der Eintritt davor.
    #[tokio::test]
    async fn ruecknahme_bringt_auf_den_platz_zurueck() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        let ein = eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        alt_machen(&pool, ein.id, "2026-05-28 13:10:00").await;
        let aus = austritt(&pool, e, p, None, b).await.unwrap();
        assert_eq!(verfuegbarkeit(&pool, pa).await, "aufbereitung");

        let r = nimm_austritt_zurueck(&pool, e, p, aus.id, b).await.unwrap();
        assert!(!r.ohne_platz);
        assert_eq!(r.ereignis.ruecknahme_von, Some(aus.id));
        assert_eq!(cache(&pool, p).await, (Some(u), Some(pa)));
        assert_eq!(verfuegbarkeit(&pool, pa).await, "frei");
        let a = aufenthalt(&pool, e, p).await.unwrap().unwrap();
        assert_eq!(a.seit.as_deref(), Some("2026-05-28 13:10:00"));

        // Zweites Mal: schon zurückgenommen.
        let r = nimm_austritt_zurueck(&pool, e, p, aus.id, b).await;
        assert!(matches!(r, Err(AppError::Conflict(_))), "{r:?}");
    }

    /// LLH-1924: liegt inzwischen jemand anderes auf dem Platz, kommt die Person in den
    /// Wartebereich; ist sie weiter gebucht oder das Austragen zu alt, 409 ohne Änderung.
    #[tokio::test]
    async fn ruecknahme_ohne_platz_und_ablehnungen() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        let andere: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'betroffen', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        let aus = austritt(&pool, e, p, None, b).await.unwrap();
        sqlx::query("UPDATE uhs_platz SET verfuegbarkeit = 'frei' WHERE id = ?")
            .bind(pa)
            .execute(&pool)
            .await
            .unwrap();
        eintritt(&pool, e, andere, u, Some(pa), None, b)
            .await
            .unwrap();
        let r = nimm_austritt_zurueck(&pool, e, p, aus.id, b).await.unwrap();
        assert!(r.ohne_platz);
        assert_eq!(cache(&pool, p).await, (Some(u), None));

        // Weiter gebucht: nach erneutem Austritt eine neue Aufnahme.
        let aus = austritt(&pool, e, p, None, b).await.unwrap();
        eintritt(&pool, e, p, u, None, None, b).await.unwrap();
        let r = nimm_austritt_zurueck(&pool, e, p, aus.id, b).await;
        assert!(
            matches!(&r, Err(AppError::Conflict(m)) if m.contains("weiter gebucht")),
            "{r:?}"
        );

        // Zu alt.
        let aus = austritt(&pool, e, p, None, b).await.unwrap();
        alt_machen(&pool, aus.id, "2026-01-01 08:00:00").await;
        let r = nimm_austritt_zurueck(&pool, e, p, aus.id, b).await;
        assert!(
            matches!(&r, Err(AppError::Conflict(m)) if m.contains("Minuten")),
            "{r:?}"
        );
        assert_eq!(cache(&pool, p).await, (None, None));

        // Kein Austritt: 404.
        let r = nimm_austritt_zurueck(&pool, e, p, aus.id - 1, b).await;
        assert!(matches!(r, Err(AppError::NotFound)), "{r:?}");
    }

    /// Review LLH-1924: ein automatischer Austritt (mit Anlass) wird nicht zurückgenommen.
    #[tokio::test]
    async fn ruecknahme_nicht_fuer_austritt_mit_anlass() {
        let pool = test_pool().await;
        let (b, e, u, _, _, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, None, None, b).await.unwrap();
        let aus = austritt(&pool, e, p, Some("durch Verbleib"), b)
            .await
            .unwrap();
        let r = nimm_austritt_zurueck(&pool, e, p, aus.id, b).await;
        assert!(
            matches!(&r, Err(AppError::Conflict(m)) if m.contains("Anlass")),
            "{r:?}"
        );
    }

    /// LLH-1924 (Review): eine Rücknahme ist kein neuer Zugang; ein nachgereichter Verbleib vor
    /// dem Austritt holt die Person weiter aus der UHS.
    #[tokio::test]
    async fn ruecknahme_zaehlt_nicht_als_zugang_nach() {
        let pool = test_pool().await;
        let (b, e, u, _, _, _, p) = setup(&pool).await;
        let ein = eintritt(&pool, e, p, u, None, None, b).await.unwrap();
        alt_machen(&pool, ein.id, "2026-05-28 13:00:00").await;
        let aus = austritt(&pool, e, p, None, b).await.unwrap();
        nimm_austritt_zurueck(&pool, e, p, aus.id, b).await.unwrap();
        let mut conn = pool.acquire().await.unwrap();
        assert!(!has_zugang_nach_tx(&mut conn, e, p, "2026-05-28 13:20:00")
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn auto_aufbereitung_asymmetrie_defekt_bleibt_defekt() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        // Während belegt: defekt setzen (informativ, Belegung bleibt unberührt — Spec):
        sqlx::query("UPDATE uhs_platz SET verfuegbarkeit = 'defekt' WHERE id = ?")
            .bind(pa)
            .execute(&pool)
            .await
            .unwrap();
        austritt(&pool, e, p, None, b).await.unwrap();
        assert_eq!(
            verfuegbarkeit(&pool, pa).await,
            "defekt",
            "Auto-Aufbereitung greift NUR, wenn vorher frei"
        );
    }

    #[tokio::test]
    async fn wechsel_ohne_aktive_belegung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        let err = wechsel(&pool, e, p, u, Some(pa), None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "wechsel ohne aktive Belegung"
        );
    }

    #[tokio::test]
    async fn austritt_ohne_aktive_belegung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e, _, _, _, _, p) = setup(&pool).await;
        let err = austritt(&pool, e, p, None, b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn liste_je_uhs_neueste_zuerst() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, None, None, b).await.unwrap();
        wechsel(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        let liste = liste_je_uhs(&pool, u).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].art, BelegungsArt::Wechsel, "neueste zuerst");
    }

    #[tokio::test]
    async fn austritt_intern_fuer_unbelegte_person_ist_noop() {
        let pool = test_pool().await;
        let (b, e, _, _, _, _, p) = setup(&pool).await;
        let info = austritt_intern(&pool, e, p, Some("durch Storno"), b)
            .await
            .unwrap();
        assert!(
            info.is_none(),
            "Person war nicht belegt — kein Event, kein Cache-Wechsel"
        );
    }

    #[tokio::test]
    async fn austritt_intern_loest_reservierung_der_person_auf() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        // Person ist NICHT belegt, aber für pa reserviert:
        platz_repo::setze_verfuegbarkeit(&pool, u, pa, "reserviert", Some(p))
            .await
            .unwrap();
        austritt_intern(&pool, e, p, Some("durch Storno"), b)
            .await
            .unwrap();
        assert_eq!(
            verfuegbarkeit(&pool, pa).await,
            "frei",
            "Reservierung der Person wird aufgelöst"
        );
    }
}
