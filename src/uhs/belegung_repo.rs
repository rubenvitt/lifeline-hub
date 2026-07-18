use super::BelegungAnzeige;
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, person_id, uhs_id, platz_id, art, notiz, zeitpunkt_at, erfasst_von \
    FROM person_uhs_belegung";

/// Was beim Auto-Austritt passiert ist (für ETB-Text und SSE im Wrapper).
#[derive(Debug, Clone)]
pub struct AustrittInfo {
    pub uhs_id: i64,
    pub platz_id: Option<i64>,
    pub event_id: i64,
}

/// Eintritt einer Person in eine UHS. Vorbedingungen: UHS = `aktiv`, Person nicht
/// schon belegt; falls Platz: Verfügbarkeits-Regel (siehe Spec Annahme 10/12).
/// Inbox-Eintritt = `platz_id = None`. Schreibt das Event + Cache-Update + ggf.
/// Reservierungs-Einlösung in EINER Transaktion.
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
        )
        .await?;
        update_cache(&mut *conn, einsatz_id, person_id, Some(uhs_id), platz_id).await?;
        if let Some(pid) = platz_id {
            loese_eigene_reservierung_ein(&mut *conn, pid, person_id).await?;
        }
        Ok(id)
    })?;
    laden(pool, einsatz_id, id).await
}

/// UHS-/Platz-Wechsel einer Person. Erfordert aktive Belegung der Person.
/// Ziel-UHS muss `aktiv` sein; falls Ziel-Platz: Verfügbarkeits-Regel. Vor dem
/// Wechsel wird der ehemalige Platz (falls vorhanden) auto-aufbereitet (nur, wenn
/// vorher `frei`). Alles in EINER Tx.
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

/// Manueller Austritt. Erfordert aktive Belegung. Schreibt Event, leert Cache,
/// auto-aufbereitet Ex-Platz (falls vorher frei). Alles in EINER Tx.
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

/// Auto-Austritt-Helper für Cross-Modul-Hooks (E‑1-Status/E‑2-Verbleib/E‑1-Storno).
/// Macht in EINER Tx: (a) wenn Person belegt → Austritt-Event + Cache-Cleanup +
/// Auto-Aufbereitung; (b) IMMER → etwaige Reservierungen `reserviert_fuer_person_id =
/// person_id` auflösen (Spec: Reservierungs-Folgekonsistenz).
///
/// Liefert `Some(AustrittInfo)` nur, wenn ein Austritt-Event geschrieben wurde —
/// der Wrapper (Task 9) braucht das für ETB-Text + SSE. Bei `None` (Person war nicht
/// belegt) hat trotzdem ggf. ein Reservierungs-Cleanup stattgefunden.
pub async fn austritt_intern(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<Option<AustrittInfo>, AppError> {
    crate::write_retry!(pool, |conn| {
        let (ex_uhs, ex_platz) = lade_cache(&mut *conn, person_id).await?;
        // Reservierungs-Cleanup IMMER (Spec: bei Storno / Status verstorben / abgemeldet):
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
    })
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

async fn insert_event(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    uhs_id: i64,
    platz_id: Option<i64>,
    art: &str,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<i64, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO person_uhs_belegung \
            (einsatz_id, person_id, uhs_id, platz_id, art, notiz, erfasst_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(uhs_id)
    .bind(platz_id)
    .bind(art)
    .bind(notiz)
    .bind(erfasst_von)
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
    // Bei Cache-Setzung kann der partielle Unique-Index zuschlagen (anderer
    // Person bereits aktueller_platz_id = platz_id). Konflikt mappen.
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
        // F09/LFH-240 red→green: das echte eintritt (deferred BEGIN → read-then-write)
        // darf unter einem kurz konkurrierenden Writer NICHT mit SQLITE_BUSY (500)
        // scheitern. ROT auf dem Ist-Code: der deferred Read-Snapshot macht den ersten
        // Write zum Lock-Upgrade → sofortiges BUSY. GRÜN nach BEGIN IMMEDIATE (parkt am
        // BEGIN, wo der busy_timeout warten darf, bis Writer B nach 200ms committet).
        // Braucht das Datei/WAL-Harness (F28) — mit test_pool() (1 Conn) unsichtbar.
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
