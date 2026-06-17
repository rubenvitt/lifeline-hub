use super::{darf_uebergehen, BrAnzeige};
use crate::error::AppError;
use sqlx::SqlitePool;

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, abschnitt_id, bezeichnung, standort, notiz, status, \
           erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at \
    FROM bereitstellungsraum";

/// Eingabedaten beim Anlegen (Handler hat `bezeichnung` validiert/getrimmt).
#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub bezeichnung: &'a str,
    pub abschnitt_id: Option<i64>,
    pub standort: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

/// Patch-Daten (COALESCE-Semantik: `None` = unverändert). Status wird NICHT
/// über diese Funktion geändert — Status hat eine eigene Route.
#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub bezeichnung: Option<&'a str>,
    pub abschnitt_id: Option<Option<i64>>, // Some(None) = explizit auf NULL setzen
    pub standort: Option<Option<&'a str>>,
    pub notiz: Option<Option<&'a str>>,
}

/// BR eines Einsatzes (ohne stornierte), optional gefiltert nach Status und/oder Abschnitt.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<&str>,
    abschnitt_id: Option<i64>,
) -> Result<Vec<BrAnzeige>, AppError> {
    let sql = format!(
        "{SELECT_ALLE} WHERE einsatz_id = ?1 AND storniert_at IS NULL \
         AND (?2 IS NULL OR status = ?2) \
         AND (?3 IS NULL OR abschnitt_id = ?3) \
         ORDER BY bezeichnung"
    );
    Ok(sqlx::query_as::<_, BrAnzeige>(&sql)
        .bind(einsatz_id)
        .bind(status)
        .bind(abschnitt_id)
        .fetch_all(pool)
        .await?)
}

/// Lädt einen BR (auch stornierte) eines Einsatzes; `NotFound`, falls er nicht
/// zum Einsatz gehört (Org-Isolation via `einsatz_id`-Prädikat).
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<BrAnzeige, AppError> {
    sqlx::query_as::<_, BrAnzeige>(&format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    ))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt einen BR im Status `geplant` an. UNIQUE(einsatz_id, bezeichnung) →
/// `Conflict` (409) bei Duplikat.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<BrAnzeige, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO bereitstellungsraum \
            (einsatz_id, abschnitt_id, bezeichnung, standort, notiz, \
             erfasst_von, geaendert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.abschnitt_id)
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
                "Ein Bereitstellungsraum mit dieser Bezeichnung existiert bereits in diesem Einsatz"
                    .into(),
            ));
        }
        Err(e) => return Err(e.into()),
    };
    laden(pool, einsatz_id, id).await
}

/// Aktualisiert BR-Stammfelder (NICHT Status). `Some(None)` setzt ein Feld
/// explizit auf NULL (z. B. Standort löschen); `None` lässt unverändert.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    geaendert_von: i64,
    daten: PatchDaten<'_>,
) -> Result<BrAnzeige, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE bereitstellungsraum \
         SET bezeichnung = COALESCE(?1, bezeichnung), \
             abschnitt_id = CASE WHEN ?2 IS NULL THEN abschnitt_id ELSE ?3 END, \
             standort = CASE WHEN ?4 IS NULL THEN standort ELSE ?5 END, \
             notiz = CASE WHEN ?6 IS NULL THEN notiz ELSE ?7 END, \
             geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
             geaendert_von = ?8 \
         WHERE id = ?9 AND einsatz_id = ?10",
    )
    .bind(daten.bezeichnung)
    .bind(daten.abschnitt_id.map(|_| 1_i64))
    .bind(daten.abschnitt_id.and_then(|v| v))
    .bind(daten.standort.map(|_| 1_i64))
    .bind(daten.standort.and_then(|v| v))
    .bind(daten.notiz.map(|_| 1_i64))
    .bind(daten.notiz.and_then(|v| v))
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await;
    match ergebnis {
        Ok(r) if r.rows_affected() == 0 => Err(AppError::NotFound),
        Ok(_) => laden(pool, einsatz_id, id).await,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Ein Bereitstellungsraum mit dieser Bezeichnung existiert bereits in diesem Einsatz"
                .into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Setzt einen neuen Status. Prüft Transition via `darf_uebergehen` (422 bei
/// ungültigem Übergang) und die Belegungs-Vorbedingung für `aufgeloest`:
/// blockt mit `Conflict` (409), wenn aktiv belegt (Einheit oder Fahrzeug).
pub async fn setze_status(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    neuer_status: &str,
    geaendert_von: i64,
) -> Result<BrAnzeige, AppError> {
    // Transition validieren (Repo-Ebene, da kein Handler für diesen Task).
    let aktuell: String = sqlx::query_scalar(
        "SELECT status FROM bereitstellungsraum WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    if !darf_uebergehen(&aktuell, neuer_status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang '{aktuell}' → '{neuer_status}' ist nicht erlaubt"
        )));
    }

    // Für aufgeloest: aktive Belegung blockt.
    if neuer_status == "aufgeloest" {
        let belegt = aktive_belegungen(pool, id).await?;
        if belegt > 0 {
            return Err(AppError::Conflict(format!(
                "Auflösung nicht möglich — noch {belegt} Einheit(en)/Fahrzeug(e) belegt"
            )));
        }
    }

    sqlx::query(
        "UPDATE bereitstellungsraum SET status = ?, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(neuer_status)
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;

    laden(pool, einsatz_id, id).await
}

/// Soft-Delete des BR. Blockt mit `Conflict`, wenn aktive Belegung existiert
/// (Einheit oder Fahrzeug). Doppel-Storno → `Conflict`.
pub async fn storniere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let belegt = aktive_belegungen(pool, id).await?;
    if belegt > 0 {
        return Err(AppError::Conflict(format!(
            "Storno nicht möglich — noch {belegt} Einheit(en)/Fahrzeug(e) belegt"
        )));
    }
    let ergebnis = sqlx::query(
        "UPDATE bereitstellungsraum \
         SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
             geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
             geaendert_von = ? \
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
            "SELECT storniert_at FROM bereitstellungsraum WHERE id = ? AND einsatz_id = ?",
        )
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
        return match existiert {
            None => Err(AppError::NotFound),
            Some(_) => Err(AppError::Conflict("BR ist bereits storniert".into())),
        };
    }
    Ok(())
}

/// Anzahl aktiv belegter Einheiten + Fahrzeuge über den denormalisierten Cache.
/// Prüft sowohl `einsatz_einheit.aktueller_br_id` als auch
/// `einsatz_fahrzeug.aktueller_br_id` (jeweils ein indizierter Scan).
pub async fn aktive_belegungen(pool: &SqlitePool, br_id: i64) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT \
            (SELECT COUNT(*) FROM einsatz_einheit  WHERE aktueller_br_id = ?) + \
            (SELECT COUNT(*) FROM einsatz_fahrzeug WHERE aktueller_br_id = ?)",
    )
    .bind(br_id)
    .bind(br_id)
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
             VALUES (1, 'Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    fn neu<'a>(bez: &'a str) -> NeueDaten<'a> {
        NeueDaten {
            bezeichnung: bez,
            abschnitt_id: None,
            standort: None,
            notiz: None,
        }
    }

    // --- Pflicht-Tests aus dem Brief ---

    #[tokio::test]
    async fn anlegen_liefert_geplant() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(
            &pool,
            e,
            b,
            NeueDaten {
                bezeichnung: "BR Nord",
                abschnitt_id: None,
                standort: None,
                notiz: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(br.status, "geplant");
    }

    #[tokio::test]
    async fn status_geplant_aktiv_aufgeloest() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(
            &pool,
            e,
            b,
            NeueDaten {
                bezeichnung: "BR 1",
                abschnitt_id: None,
                standort: None,
                notiz: None,
            },
        )
        .await
        .unwrap();
        let a = setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
        assert_eq!(a.status, "aktiv");
    }

    // --- Erweiterte Tests ---

    #[tokio::test]
    async fn anlegen_setzt_zeitstempel_und_benutzer() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR Süd")).await.unwrap();
        assert_eq!(br.einsatz_id, e);
        assert_eq!(br.bezeichnung, "BR Süd");
        assert_eq!(br.erfasst_von, b);
        assert_eq!(br.geaendert_von, b);
        assert!(br.storniert_at.is_none());
    }

    #[tokio::test]
    async fn anlegen_doppelte_bezeichnung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, neu("BR Ost")).await.unwrap();
        let err = anlegen(&pool, e, b, neu("BR Ost")).await.unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "UNIQUE(einsatz_id, bezeichnung)"
        );
    }

    #[tokio::test]
    async fn laden_fremd_liefert_not_found() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR X")).await.unwrap();
        // Falscher einsatz_id → NotFound (Org-Isolation)
        let err = laden(&pool, e + 999, br.id).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[tokio::test]
    async fn laden_liefert_auch_stornierte() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR Storno")).await.unwrap();
        storniere(&pool, e, br.id, b).await.unwrap();
        let geladen = laden(&pool, e, br.id).await.unwrap();
        assert!(geladen.storniert_at.is_some());
    }

    #[tokio::test]
    async fn liste_filtert_stornierte_und_status() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br1 = anlegen(&pool, e, b, neu("BR A")).await.unwrap();
        anlegen(&pool, e, b, neu("BR B")).await.unwrap();
        // Storno: br1 verschwindet aus der Liste:
        storniere(&pool, e, br1.id, b).await.unwrap();
        let alle = liste(&pool, e, None, None).await.unwrap();
        assert_eq!(alle.len(), 1, "stornierte BR fallen aus der Liste");
        // Status-Filter:
        let geplante = liste(&pool, e, Some("geplant"), None).await.unwrap();
        assert_eq!(geplante.len(), 1);
        let aktive = liste(&pool, e, Some("aktiv"), None).await.unwrap();
        assert!(aktive.is_empty());
    }

    #[tokio::test]
    async fn aktualisiere_felder() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR Alt")).await.unwrap();
        let nach = aktualisiere(
            &pool,
            e,
            br.id,
            b,
            PatchDaten {
                bezeichnung: Some("BR Neu"),
                standort: Some(Some("Marktplatz")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(nach.bezeichnung, "BR Neu");
        assert_eq!(nach.standort.as_deref(), Some("Marktplatz"));
        assert_eq!(nach.geaendert_von, b);
    }

    #[tokio::test]
    async fn aktualisiere_not_found_bei_falscher_einsatz_id() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR Y")).await.unwrap();
        let err = aktualisiere(&pool, e + 999, br.id, b, PatchDaten::default())
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[tokio::test]
    async fn ungueltige_status_transition_ist_422() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR Z")).await.unwrap();
        // geplant → aufgeloest ist erlaubt, aber aktiv → geplant ist verboten
        setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
        let err = setze_status(&pool, e, br.id, "geplant", b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::UnprocessableEntity(_)),
            "Rückwärts-Transition → 422"
        );
    }

    #[tokio::test]
    async fn setze_status_not_found_bei_falschem_einsatz() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR NotFound")).await.unwrap();
        let err = setze_status(&pool, e + 999, br.id, "aktiv", b)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[tokio::test]
    async fn aufloesen_blockiert_bei_aktiver_einheit_belegung() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR Block")).await.unwrap();
        setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
        // Einheit anlegen und BR-Cache setzen (belegung_repo kommt erst in Task 4):
        sqlx::query(
            "INSERT INTO einsatz_einheit (einsatz_id, name, aktueller_br_id) \
             VALUES (?, 'Einheit 1', ?)",
        )
        .bind(e)
        .bind(br.id)
        .execute(&pool)
        .await
        .unwrap();
        let err = setze_status(&pool, e, br.id, "aufgeloest", b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Auflösung blockt bei Belegung (409)"
        );
        // Storno blockt identisch:
        let err = storniere(&pool, e, br.id, b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn aufloesen_blockiert_bei_aktiver_fahrzeug_belegung() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR Block Fz")).await.unwrap();
        setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
        // Fahrzeug anlegen mit BR-Cache:
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, aktueller_br_id) \
             VALUES (?, 'FLF 1', ?)",
        )
        .bind(e)
        .bind(br.id)
        .execute(&pool)
        .await
        .unwrap();
        let err = setze_status(&pool, e, br.id, "aufgeloest", b)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn storniere_doppelt_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR Doppel")).await.unwrap();
        storniere(&pool, e, br.id, b).await.unwrap();
        let err = storniere(&pool, e, br.id, b).await.unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Doppel-Storno → Conflict"
        );
    }

    #[tokio::test]
    async fn aktive_belegungen_zaehlt_einheit_und_fahrzeug() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = anlegen(&pool, e, b, neu("BR Zaehlen")).await.unwrap();
        assert_eq!(aktive_belegungen(&pool, br.id).await.unwrap(), 0);
        // Eine Einheit + ein Fahrzeug belegen:
        sqlx::query(
            "INSERT INTO einsatz_einheit (einsatz_id, name, aktueller_br_id) VALUES (?, 'E1', ?)",
        )
        .bind(e)
        .bind(br.id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, aktueller_br_id) VALUES (?, 'FLF1', ?)",
        )
        .bind(e)
        .bind(br.id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(aktive_belegungen(&pool, br.id).await.unwrap(), 2);
        // Ungebundenes Fahrzeug zählt nicht:
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FLF2')",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(aktive_belegungen(&pool, br.id).await.unwrap(), 2);
    }
}
