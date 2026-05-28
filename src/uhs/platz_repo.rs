use super::PlatzAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

const SELECT_ALLE: &str = "\
    SELECT id, uhs_id, typ, bezeichnung, pos_x, pos_y, verfuegbarkeit, \
           reserviert_fuer_person_id, storniert_at \
    FROM uhs_platz";

/// Neuer Platz (Handler hat Typ + Bezeichnung validiert/getrimmt). Verfügbarkeit
/// startet immer `frei` (Default in der Tabelle).
#[derive(Debug)]
pub struct NeuerPlatz<'a> {
    pub typ: &'a str,
    pub bezeichnung: &'a str,
    pub pos_x: Option<f64>,
    pub pos_y: Option<f64>,
}

/// Patch-Daten. `Some(None)` = explizit auf NULL (Position löschen).
#[derive(Debug, Default)]
pub struct PatchPlatz<'a> {
    pub bezeichnung: Option<&'a str>,
    pub pos_x: Option<Option<f64>>,
    pub pos_y: Option<Option<f64>>,
}

/// Plätze einer UHS (ohne stornierte), sortiert nach Bezeichnung.
pub async fn liste_je_uhs(pool: &SqlitePool, uhs_id: i64) -> Result<Vec<PlatzAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, PlatzAnzeige>(&format!(
        "{SELECT_ALLE} WHERE uhs_id = ? AND storniert_at IS NULL ORDER BY bezeichnung"
    ))
    .bind(uhs_id)
    .fetch_all(pool)
    .await?)
}

/// Lädt einen Platz; `NotFound`, falls nicht zur UHS gehörend.
pub async fn laden(pool: &SqlitePool, uhs_id: i64, id: i64) -> Result<PlatzAnzeige, AppError> {
    sqlx::query_as::<_, PlatzAnzeige>(&format!("{SELECT_ALLE} WHERE id = ? AND uhs_id = ?"))
        .bind(id)
        .bind(uhs_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Legt einen Platz an. UNIQUE(uhs_id, bezeichnung) → `Conflict` (409) bei Duplikat.
pub async fn anlegen(pool: &SqlitePool, uhs_id: i64, neu: NeuerPlatz<'_>) -> Result<PlatzAnzeige, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO uhs_platz (uhs_id, typ, bezeichnung, pos_x, pos_y) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(uhs_id)
    .bind(neu.typ)
    .bind(neu.bezeichnung)
    .bind(neu.pos_x)
    .bind(neu.pos_y)
    .fetch_one(pool)
    .await;
    let id = match ergebnis {
        Ok(id) => id,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            return Err(AppError::Conflict(
                "Ein Platz mit dieser Bezeichnung existiert bereits in dieser UHS".into(),
            ));
        }
        Err(e) => return Err(e.into()),
    };
    laden(pool, uhs_id, id).await
}

/// Aktualisiert Stamm/Layout eines Platzes (NICHT Verfügbarkeit — eigene Funktion).
/// `Some(None)` = explizites NULL; `None` = unverändert.
pub async fn aktualisiere(
    pool: &SqlitePool,
    uhs_id: i64,
    id: i64,
    daten: PatchPlatz<'_>,
) -> Result<PlatzAnzeige, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE uhs_platz \
         SET bezeichnung = COALESCE(?1, bezeichnung), \
             pos_x = CASE WHEN ?2 IS NULL THEN pos_x ELSE ?3 END, \
             pos_y = CASE WHEN ?4 IS NULL THEN pos_y ELSE ?5 END \
         WHERE id = ?6 AND uhs_id = ?7",
    )
    // ?1 = bezeichnung (COALESCE: None = keep existing)
    .bind(daten.bezeichnung)
    // ?2 = pos_x sentinel (Some(_) → 1, None → NULL), ?3 = new value
    .bind(daten.pos_x.map(|_| 1_i64))
    .bind(daten.pos_x.and_then(|v| v))
    // ?4 = pos_y sentinel, ?5 = new value
    .bind(daten.pos_y.map(|_| 1_i64))
    .bind(daten.pos_y.and_then(|v| v))
    // ?6 = id, ?7 = uhs_id
    .bind(id)
    .bind(uhs_id)
    .execute(pool)
    .await;
    match ergebnis {
        Ok(r) if r.rows_affected() == 0 => Err(AppError::NotFound),
        Ok(_) => laden(pool, uhs_id, id).await,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Ein Platz mit dieser Bezeichnung existiert bereits in dieser UHS".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Setzt Verfügbarkeit (und ggf. Reservierungs-FK).
///
/// Semantik:
/// - `reserviert` erfordert `person_id = Some(_)` (sonst `Validation` 422) UND der Platz
///   darf nicht durch eine andere Person belegt sein (sonst `UnprocessableEntity` 422).
/// - Jeder andere Wert leert `reserviert_fuer_person_id` (Reservierung wird aufgelöst).
///
/// Wird Belegungs-getriggert (Reservierung wird durch Belegung eingelöst), ruft
/// `belegung_repo` diese Funktion NICHT direkt — die Einlösung läuft inline in
/// derselben Tx (Task 8).
pub async fn setze_verfuegbarkeit(
    pool: &SqlitePool,
    uhs_id: i64,
    id: i64,
    verfuegbarkeit: &str,
    person_id: Option<i64>,
) -> Result<PlatzAnzeige, AppError> {
    // Reservierung erfordert Person:
    if verfuegbarkeit == "reserviert" && person_id.is_none() {
        return Err(AppError::Validation(
            "Reservierung erfordert eine Ziel-Person".into(),
        ));
    }
    // Reservierung erfordert unbelegten Platz (Spec: Verfügbarkeits-Statuswechsel,
    // letzter Punkt — andere Wechsel sind auch bei aktiver Belegung erlaubt).
    if verfuegbarkeit == "reserviert" {
        let belegt: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM einsatz_person WHERE aktueller_platz_id = ? LIMIT 1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        if belegt.is_some() {
            return Err(AppError::UnprocessableEntity(
                "Platz ist belegt — Reservierung nicht möglich".into(),
            ));
        }
    }
    let neue_person_fk = if verfuegbarkeit == "reserviert" { person_id } else { None };
    let ergebnis = sqlx::query(
        "UPDATE uhs_platz SET verfuegbarkeit = ?, reserviert_fuer_person_id = ? \
         WHERE id = ? AND uhs_id = ?",
    )
    .bind(verfuegbarkeit)
    .bind(neue_person_fk)
    .bind(id)
    .bind(uhs_id)
    .execute(pool)
    .await?;
    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, uhs_id, id).await
}

/// Soft-Delete eines Platzes; blockt mit `Conflict`, wenn aktuell belegt.
pub async fn storniere(pool: &SqlitePool, uhs_id: i64, id: i64) -> Result<(), AppError> {
    let belegt: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_person WHERE aktueller_platz_id = ? LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    if belegt.is_some() {
        return Err(AppError::Conflict(
            "Platz ist aktuell belegt — Storno nicht möglich".into(),
        ));
    }
    let ergebnis = sqlx::query(
        "UPDATE uhs_platz SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now') \
         WHERE id = ? AND uhs_id = ? AND storniert_at IS NULL",
    )
    .bind(id)
    .bind(uhs_id)
    .execute(pool)
    .await?;
    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use crate::uhs::repo as uhs_repo;
    use sqlx::SqlitePool;

    /// Liefert (benutzer, einsatz, uhs_id, person_a, person_b).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let u = uhs_repo::anlegen(
            pool, e, b,
            uhs_repo::NeueDaten { typ: "behandlungsplatz", bezeichnung: "BHP 50",
                                  abschnitt_id: None, standort: None, notiz: None },
        ).await.unwrap();
        uhs_repo::setze_status(pool, e, u.id, "aktiv", b).await.unwrap();
        let mk = |nr: i64| {
            let e = e; let b = b; let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
                     VALUES (?, ?, 'betroffen', ?, ?) RETURNING id")
                    .bind(e).bind(nr).bind(b).bind(b)
                    .fetch_one(&pool).await.unwrap()
            }
        };
        let pa = mk(1).await;
        let pb = mk(2).await;
        (b, e, u.id, pa, pb)
    }

    #[tokio::test]
    async fn anlegen_default_verfuegbarkeit_frei() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz {
            typ: "bett", bezeichnung: "Bett 3", pos_x: Some(100.0), pos_y: Some(50.0),
        }).await.unwrap();
        assert_eq!(p.verfuegbarkeit, "frei");
        assert_eq!(p.pos_x, Some(100.0));
        assert!(p.reserviert_fuer_person_id.is_none());
    }

    #[tokio::test]
    async fn anlegen_doppelte_bezeichnung_ist_konflikt() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        let err = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn aktualisiere_position() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        let nach = aktualisiere(&pool, u, p.id, PatchPlatz {
            bezeichnung: None, pos_x: Some(Some(42.0)), pos_y: Some(Some(99.0)),
        }).await.unwrap();
        assert_eq!(nach.pos_x, Some(42.0));
        assert_eq!(nach.pos_y, Some(99.0));
    }

    #[tokio::test]
    async fn setze_verfuegbarkeit_frei_zu_defekt_ohne_person() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        let nach = setze_verfuegbarkeit(&pool, u, p.id, "defekt", None).await.unwrap();
        assert_eq!(nach.verfuegbarkeit, "defekt");
    }

    #[tokio::test]
    async fn setze_verfuegbarkeit_reserviert_braucht_person() {
        let pool = test_pool().await;
        let (_b, _e, u, pa, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        let err = setze_verfuegbarkeit(&pool, u, p.id, "reserviert", None).await.unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "Reservieren ohne Person ist Validierung-422");
        let nach = setze_verfuegbarkeit(&pool, u, p.id, "reserviert", Some(pa)).await.unwrap();
        assert_eq!(nach.verfuegbarkeit, "reserviert");
        assert_eq!(nach.reserviert_fuer_person_id, Some(pa));
    }

    #[tokio::test]
    async fn setze_verfuegbarkeit_aufloesen_leert_person_fk() {
        let pool = test_pool().await;
        let (_b, _e, u, pa, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        setze_verfuegbarkeit(&pool, u, p.id, "reserviert", Some(pa)).await.unwrap();
        let nach = setze_verfuegbarkeit(&pool, u, p.id, "frei", None).await.unwrap();
        assert_eq!(nach.verfuegbarkeit, "frei");
        assert!(nach.reserviert_fuer_person_id.is_none(), "FK wird beim Verlassen von 'reserviert' geleert");
    }

    #[tokio::test]
    async fn reservierung_auf_belegtem_platz_ist_konflikt() {
        let pool = test_pool().await;
        let (_b, _e, u, pa, pb) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        // pb auf p belegen (direkter Cache-Setz; belegung_repo erst Task 8):
        sqlx::query("UPDATE einsatz_person SET aktuelle_uhs_id = ?, aktueller_platz_id = ? WHERE id = ?")
            .bind(u).bind(p.id).bind(pb).execute(&pool).await.unwrap();
        let err = setze_verfuegbarkeit(&pool, u, p.id, "reserviert", Some(pa)).await.unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)),
            "Reservieren eines belegten Platzes → 422 (Spec: Verfügbarkeits-Statuswechsel)");
    }

    #[tokio::test]
    async fn storniere_blockt_bei_belegung() {
        let pool = test_pool().await;
        let (b, _e, u, _, pb) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        sqlx::query("UPDATE einsatz_person SET aktuelle_uhs_id = ?, aktueller_platz_id = ? WHERE id = ?")
            .bind(u).bind(p.id).bind(pb).execute(&pool).await.unwrap();
        let err = storniere(&pool, u, p.id).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
        let _ = b;
    }

    #[tokio::test]
    async fn liste_je_uhs_filtert_storno() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        let p1 = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 1", pos_x: None, pos_y: None }).await.unwrap();
        anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 2", pos_x: None, pos_y: None }).await.unwrap();
        storniere(&pool, u, p1.id).await.unwrap();
        assert_eq!(liste_je_uhs(&pool, u).await.unwrap().len(), 1);
    }
}
