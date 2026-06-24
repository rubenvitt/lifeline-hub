use super::UhsAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, abschnitt_id, typ, bezeichnung, standort, notiz, status, \
           lat, lon, \
           erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at \
    FROM uhs";

/// Eingabedaten beim Anlegen (Handler hat Typ/`bezeichnung` validiert/getrimmt).
#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub typ: &'a str,
    pub bezeichnung: &'a str,
    pub abschnitt_id: Option<i64>,
    pub standort: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

/// Patch-Daten (COALESCE-Semantik: `None` = unverändert). `typ` und `status`
/// werden NICHT über diese Funktion geändert — Status hat eine eigene Route.
#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub bezeichnung: Option<&'a str>,
    pub abschnitt_id: Option<Option<i64>>, // Some(None) = explizit auf NULL setzen
    pub standort: Option<Option<&'a str>>,
    pub notiz: Option<Option<&'a str>>,
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
}

/// UHS eines Einsatzes (ohne stornierte), optional gefiltert nach Status und/oder Abschnitt.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<&str>,
    abschnitt_id: Option<i64>,
) -> Result<Vec<UhsAnzeige>, AppError> {
    let sql = format!(
        "{SELECT_ALLE} WHERE einsatz_id = ?1 AND storniert_at IS NULL \
         AND (?2 IS NULL OR status = ?2) \
         AND (?3 IS NULL OR abschnitt_id = ?3) \
         ORDER BY bezeichnung"
    );
    Ok(sqlx::query_as::<_, UhsAnzeige>(sqlx::AssertSqlSafe(&*sql))
        .bind(einsatz_id)
        .bind(status)
        .bind(abschnitt_id)
        .fetch_all(pool)
        .await?)
}

/// Lädt eine UHS (auch stornierte) eines Einsatzes; `NotFound`, falls sie nicht
/// zum Einsatz gehört (Org-Isolation via `einsatz_id`-Prädikat).
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<UhsAnzeige, AppError> {
    sqlx::query_as::<_, UhsAnzeige>(sqlx::AssertSqlSafe(format!("{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?")))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Legt eine UHS im Status `geplant` an. UNIQUE(einsatz_id, bezeichnung) →
/// `Conflict` (409) bei Duplikat.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<UhsAnzeige, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO uhs \
            (einsatz_id, abschnitt_id, typ, bezeichnung, standort, notiz, \
             erfasst_von, geaendert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.abschnitt_id)
    .bind(daten.typ)
    .bind(daten.bezeichnung)
    .bind(daten.standort)
    .bind(daten.notiz)
    .bind(erfasser_id)
    .bind(erfasser_id)
    .fetch_one(pool)
    .await;
    let id = match ergebnis {
        Ok(id) => id,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            return Err(AppError::Conflict(
                "Eine UHS mit dieser Bezeichnung existiert bereits in diesem Einsatz".into(),
            ));
        }
        Err(e) => return Err(e.into()),
    };
    laden(pool, einsatz_id, id).await
}

/// Aktualisiert UHS-Stammfelder (NICHT Status). `Some(None)` setzt ein Feld
/// explizit auf NULL (z. B. Standort löschen); `None` lässt unverändert.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    geaendert_von: i64,
    daten: PatchDaten<'_>,
) -> Result<UhsAnzeige, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE uhs \
         SET bezeichnung = COALESCE(?1, bezeichnung), \
             abschnitt_id = CASE WHEN ?2 IS NULL THEN abschnitt_id ELSE ?3 END, \
             standort = CASE WHEN ?4 IS NULL THEN standort ELSE ?5 END, \
             notiz = CASE WHEN ?6 IS NULL THEN notiz ELSE ?7 END, \
             lat = CASE WHEN ?8 IS NULL THEN lat ELSE ?9 END, \
             lon = CASE WHEN ?10 IS NULL THEN lon ELSE ?11 END, \
             geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
             geaendert_von = ?12 \
         WHERE id = ?13 AND einsatz_id = ?14",
    )
    .bind(daten.bezeichnung)
    .bind(daten.abschnitt_id.map(|_| 1_i64))
    .bind(daten.abschnitt_id.and_then(|v| v))
    .bind(daten.standort.map(|_| 1_i64))
    .bind(daten.standort.and_then(|v| v))
    .bind(daten.notiz.map(|_| 1_i64))
    .bind(daten.notiz.and_then(|v| v))
    .bind(daten.lat.map(|_| 1_i64))
    .bind(daten.lat.and_then(|v| v))
    .bind(daten.lon.map(|_| 1_i64))
    .bind(daten.lon.and_then(|v| v))
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await;
    match ergebnis {
        Ok(r) if r.rows_affected() == 0 => Err(AppError::NotFound),
        Ok(_) => laden(pool, einsatz_id, id).await,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Eine UHS mit dieser Bezeichnung existiert bereits in diesem Einsatz".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Setzt einen neuen Status. Vorbedingungen prüft der Handler (`darf_uebergehen`),
/// das Repo prüft NUR die Belegungs-Vorbedingung für `aufgeloest` (Annahme 6):
/// blockt mit `Conflict`, wenn aktiv belegt. Liefert die aktualisierte Anzeige.
pub async fn setze_status(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    neuer_status: &str,
    geaendert_von: i64,
) -> Result<UhsAnzeige, AppError> {
    if neuer_status == "aufgeloest" {
        let belegt = aktive_belegungen(pool, id).await?;
        if belegt > 0 {
            return Err(AppError::Conflict(format!(
                "Auflösung nicht möglich — noch {belegt} Person(en) belegt"
            )));
        }
    }
    let ergebnis = sqlx::query(
        "UPDATE uhs SET status = ?, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(neuer_status)
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Soft-Delete der UHS. Identische Belegungs-Vorbedingung wie `aufgeloest`
/// (Annahme 6): aktiv belegt → `Conflict`. Doppel-Storno → `Conflict`.
pub async fn storniere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let belegt = aktive_belegungen(pool, id).await?;
    if belegt > 0 {
        return Err(AppError::Conflict(format!(
            "Storno nicht möglich — noch {belegt} Person(en) belegt"
        )));
    }
    let ergebnis = sqlx::query(
        "UPDATE uhs SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ? AND storniert_at IS NULL",
    )
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if ergebnis.rows_affected() == 0 {
        // Entweder nicht zum Einsatz oder bereits storniert. Differenzierung:
        let existiert: Option<Option<String>> = sqlx::query_scalar(
            "SELECT storniert_at FROM uhs WHERE id = ? AND einsatz_id = ?",
        )
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
        return match existiert {
            None => Err(AppError::NotFound),
            Some(_) => Err(AppError::Conflict("UHS ist bereits storniert".into())),
        };
    }
    Ok(())
}

/// Anzahl aktuell belegter Personen (Inbox + echte Plätze). Über den Cache
/// `einsatz_person.aktuelle_uhs_id`, daher ein einzelner indizierter Scan.
pub async fn aktive_belegungen(pool: &SqlitePool, uhs_id: i64) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_person \
         WHERE aktuelle_uhs_id = ? AND storniert_at IS NULL",
    )
    .bind(uhs_id)
    .fetch_one(pool)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Org(1) + Benutzer + aktiver Einsatz. Liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
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
        (b, e)
    }

    fn daten<'a>(typ: &'a str, bez: &'a str) -> NeueDaten<'a> {
        NeueDaten {
            typ, bezeichnung: bez, abschnitt_id: None, standort: None, notiz: None,
        }
    }

    #[tokio::test]
    async fn anlegen_liefert_status_geplant_und_zeitstempel() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        assert_eq!(u.status, "geplant");
        assert_eq!(u.typ, "behandlungsplatz");
        assert_eq!(u.bezeichnung, "BHP 50");
        assert_eq!(u.erfasst_von, b);
        assert_eq!(u.geaendert_von, b);
        assert!(u.storniert_at.is_none());
    }

    #[tokio::test]
    async fn anlegen_doppelte_bezeichnung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        let err = anlegen(&pool, e, b, daten("patientenablage", "BHP 50")).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "UNIQUE(einsatz_id, bezeichnung)");
    }

    #[tokio::test]
    async fn liste_filtert_storno_und_status() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u1 = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        anlegen(&pool, e, b, daten("patientenablage", "PA 1")).await.unwrap();
        // Storno: u1 verschwindet aus der Liste:
        storniere(&pool, e, u1.id, b).await.unwrap();
        let alle = liste(&pool, e, None, None).await.unwrap();
        assert_eq!(alle.len(), 1, "stornierte UHS fallen aus der Liste");
        // Status-Filter:
        let geplante = liste(&pool, e, Some("geplant"), None).await.unwrap();
        assert_eq!(geplante.len(), 1);
        let aktive = liste(&pool, e, Some("aktiv"), None).await.unwrap();
        assert!(aktive.is_empty());
    }

    #[tokio::test]
    async fn status_geplant_zu_aktiv_setzt_geaendert_von() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        let nach = setze_status(&pool, e, u.id, "aktiv", b).await.unwrap();
        assert_eq!(nach.status, "aktiv");
        assert_eq!(nach.geaendert_von, b);
    }

    #[tokio::test]
    async fn aufloesen_blockiert_bei_aktiver_belegung() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        setze_status(&pool, e, u.id, "aktiv", b).await.unwrap();
        // Person + Belegung simulieren — direkter SQL-Insert, weil belegung_repo erst in Task 8 kommt:
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von, aktuelle_uhs_id) \
             VALUES (?, 1, 'betroffen', ?, ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).bind(u.id)
            .fetch_one(&pool).await.unwrap();
        let err = setze_status(&pool, e, u.id, "aufgeloest", b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "Auflösung blockt bei Belegung (409)");
        // Storno blockt identisch:
        let err = storniere(&pool, e, u.id, b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
        let _ = p; // unbenutzt — nur als Belegungs-Quelle
    }

    #[tokio::test]
    async fn aktive_belegungen_zaehlt_korrekt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        // Zwei Personen, eine belegt:
        sqlx::query("INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von, aktuelle_uhs_id) \
                     VALUES (?, 1, ?, ?, ?)")
            .bind(e).bind(b).bind(b).bind(u.id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
                     VALUES (?, 2, ?, ?)")
            .bind(e).bind(b).bind(b).execute(&pool).await.unwrap();
        assert_eq!(aktive_belegungen(&pool, u.id).await.unwrap(), 1);
    }
}
