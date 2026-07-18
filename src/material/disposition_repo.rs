use super::{EinsatzMaterialAnzeige, MaterialStatus, DIENSTSTATUS_IN_DIENST};
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

/// SELECT mit aufgelöster Live-Identität (LEFT JOIN material). Status ist ein festes
/// Enum direkt auf der Zeile — kein Katalog-JOIN. Live vs. Snapshot trifft `zu_anzeige`.
const SELECT_AUFGELOEST: &str = "\
    SELECT em.id, em.einsatz_id, em.material_id, em.einheit_id, em.uhs_id, em.menge, em.status, \
           em.snap_bezeichnung, em.snap_kategorie, em.snap_bestandsnummer, \
           em.snap_traegerorganisation, em.bemerkung, em.disponiert_at, em.disponiert_von, \
           m.bezeichnung AS live_bezeichnung, m.kategorie AS live_kategorie, \
           m.bestandsnummer AS live_bestandsnummer, m.traegerorganisation AS live_traegerorganisation, \
           m.dienststatus AS live_dienststatus \
    FROM einsatz_material em \
    LEFT JOIN material m ON m.id = em.material_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    material_id: Option<i64>,
    einheit_id: Option<i64>,
    uhs_id: Option<i64>,
    menge: i64,
    #[sqlx(try_from = "String")]
    status: MaterialStatus,
    snap_bezeichnung: String,
    snap_kategorie: Option<String>,
    snap_bestandsnummer: Option<String>,
    snap_traegerorganisation: Option<String>,
    bemerkung: Option<String>,
    disponiert_at: String,
    disponiert_von: Option<i64>,
    live_bezeichnung: Option<String>,
    live_kategorie: Option<String>,
    live_bestandsnummer: Option<String>,
    live_traegerorganisation: Option<String>,
    live_dienststatus: Option<String>,
}

/// Auflösungsregel: Live-Felder aus dem Stamm nur, wenn ein Stamm-Bezug besteht, der
/// Einsatz aktiv ist UND das Material noch in Dienst ist. Sonst Snapshot. `menge`/`status`
/// kommen immer aus der Dispositionszeile.
fn zu_anzeige(row: Row, einsatz_aktiv: bool) -> EinsatzMaterialAnzeige {
    let live = row.material_id.is_some()
        && einsatz_aktiv
        && row.live_dienststatus.as_deref() == Some(DIENSTSTATUS_IN_DIENST);

    let (bezeichnung, kategorie, bestandsnummer, traeger) = if live {
        (
            row.live_bezeichnung
                .clone()
                .unwrap_or_else(|| row.snap_bezeichnung.clone()),
            row.live_kategorie,
            row.live_bestandsnummer,
            row.live_traegerorganisation,
        )
    } else {
        (
            row.snap_bezeichnung,
            row.snap_kategorie,
            row.snap_bestandsnummer,
            row.snap_traegerorganisation,
        )
    };

    EinsatzMaterialAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        material_id: row.material_id,
        einheit_id: row.einheit_id,
        uhs_id: row.uhs_id,
        ist_adhoc: row.material_id.is_none(),
        bezeichnung,
        kategorie,
        bestandsnummer,
        traegerorganisation: traeger,
        menge: row.menge,
        status: row.status,
        bemerkung: row.bemerkung,
        disponiert_at: row.disponiert_at,
        disponiert_von: row.disponiert_von,
    }
}

/// Daten für Ad-hoc-externes Material (kein Stamm-Bezug); bereits getrimmt.
/// `Copy`, damit ein Dispatch-Enum die Daten im Retry-Loop von [`crate::write_retry!`]
/// je Versuch kopieren kann (nur `&str`/`Option<&str>`-Felder → trivial kopierbar).
#[derive(Debug, Clone, Copy)]
pub struct AdhocDaten<'a> {
    pub bezeichnung: &'a str,
    pub kategorie: Option<&'a str>,
    pub bestandsnummer: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
}

/// Disponiertes Material eines Einsatzes (aufgelöst), sortiert nach Dispo-Zeit.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzMaterialAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE em.einsatz_id = ? ORDER BY em.disponiert_at, em.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| zu_anzeige(r, einsatz_aktiv))
        .collect())
}

/// Lädt eine Dispositionszeile (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden_anzeige(
    pool: &SqlitePool,
    einsatz_id: i64,
    em_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzMaterialAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE em.id = ? AND em.einsatz_id = ?"
    )))
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Wie [`laden_anzeige`], aber auf einer offenen Connection/Transaktion — für den
/// In-Tx-Reload beim atomaren Disponieren/Aktualisieren (F06/LFH-244, Tier-A): liefert die
/// frische Anzeige (Bezeichnung/Menge/Status) für ETB-Text UND Response in EINER Tx.
pub async fn laden_anzeige_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzMaterialAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE em.id = ? AND em.einsatz_id = ?"
    )))
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Disponiert Stamm-Material mit Menge. Prüft Org-Zugehörigkeit + Dienststatus, friert
/// den Identitäts-Schnappschuss ein. `NotFound` bei fremdem/unbekanntem Material,
/// `Validation` bei außer Dienst. Mehrfach-Disposition ist erlaubt (kein Conflict).
/// Liefert die neue `em_id`.
pub async fn disponiere_stamm_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    material_id: i64,
    menge: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let snap = sqlx::query_as::<
        _,
        (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        ),
    >(
        "SELECT bezeichnung, kategorie, bestandsnummer, traegerorganisation, dienststatus \
         FROM material WHERE id = ? AND org_id = ?",
    )
    .bind(material_id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;

    let (bezeichnung, kategorie, bestandsnummer, traeger, dienststatus) = snap;
    if dienststatus != DIENSTSTATUS_IN_DIENST {
        return Err(AppError::Validation(
            "Material ist außer Dienst und kann nicht disponiert werden".into(),
        ));
    }

    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_material \
            (einsatz_id, material_id, menge, snap_bezeichnung, snap_kategorie, \
             snap_bestandsnummer, snap_traegerorganisation, disponiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(material_id)
    .bind(menge)
    .bind(&bezeichnung)
    .bind(&kategorie)
    .bind(&bestandsnummer)
    .bind(&traeger)
    .bind(disponiert_von)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Pool-Wrapper: disponiert Stamm-Material in einer eigenen Connection (delegiert an
/// [`disponiere_stamm_tx`]).
pub async fn disponiere_stamm(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    material_id: i64,
    menge: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let mut conn = pool.acquire().await?;
    disponiere_stamm_tx(
        &mut conn,
        einsatz_id,
        org_id,
        material_id,
        menge,
        disponiert_von,
    )
    .await
}

/// Disponiert Ad-hoc-externes Material (`material_id = NULL`); `snap_*` sind die
/// eigentlichen Daten. Liefert die neue `em_id`.
pub async fn disponiere_adhoc_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    daten: AdhocDaten<'_>,
    menge: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_material \
            (einsatz_id, material_id, menge, snap_bezeichnung, snap_kategorie, \
             snap_bestandsnummer, snap_traegerorganisation, disponiert_von) \
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(menge)
    .bind(daten.bezeichnung)
    .bind(daten.kategorie)
    .bind(daten.bestandsnummer)
    .bind(daten.traegerorganisation)
    .bind(disponiert_von)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Pool-Wrapper: disponiert Ad-hoc-Material in einer eigenen Connection (delegiert an
/// [`disponiere_adhoc_tx`]).
pub async fn disponiere_adhoc(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: AdhocDaten<'_>,
    menge: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let mut conn = pool.acquire().await?;
    disponiere_adhoc_tx(&mut conn, einsatz_id, daten, menge, disponiert_von).await
}

/// Aktualisiert Menge, Status und/oder Bemerkung (COALESCE: `None` = unverändert).
/// `uhs_id`: `None` = unverändert; `Some(None)` = explizit auf NULL setzen;
/// `Some(Some(id))` = neue UHS zuordnen.
/// `status` muss bereits validiert sein (gültiges Enum). `NotFound`, falls die Zeile
/// nicht zum Einsatz gehört.
pub async fn aktualisiere_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    menge: Option<i64>,
    status: Option<&str>,
    bemerkung: Option<&str>,
    uhs_id: Option<Option<i64>>,
) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE einsatz_material \
         SET menge = COALESCE(?1, menge), \
             status = COALESCE(?2, status), \
             bemerkung = COALESCE(?3, bemerkung), \
             uhs_id = CASE WHEN ?4 IS NULL THEN uhs_id ELSE ?5 END \
         WHERE id = ?6 AND einsatz_id = ?7",
    )
    .bind(menge)
    .bind(status)
    .bind(bemerkung)
    .bind(uhs_id.map(|_| 1_i64)) // sentinel: Some(_) → 1, None → NULL
    .bind(uhs_id.and_then(|v| v)) // value: Some(Some(x)) → x, Some(None) → NULL
    .bind(em_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Pool-Wrapper: aktualisiert eine Dispositionszeile in einer eigenen Connection
/// (delegiert an [`aktualisiere_tx`]).
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    em_id: i64,
    menge: Option<i64>,
    status: Option<&str>,
    bemerkung: Option<&str>,
    uhs_id: Option<Option<i64>>,
) -> Result<(), AppError> {
    let mut conn = pool.acquire().await?;
    aktualisiere_tx(
        &mut conn, einsatz_id, em_id, menge, status, bemerkung, uhs_id,
    )
    .await
}

/// Disponiertes Material einer UHS (aufgelöst), sortiert nach Dispo-Zeit.
/// Filtert nach einsatz_id UND uhs_id für Org-Isolation.
pub async fn liste_je_uhs(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzMaterialAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE em.einsatz_id = ? AND em.uhs_id = ? ORDER BY em.disponiert_at, em.id"
    )))
    .bind(einsatz_id)
    .bind(uhs_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| zu_anzeige(r, einsatz_aktiv))
        .collect())
}

/// Entfernt eine Dispositionszeile aus dem Einsatz (der Stamm bleibt). `NotFound`,
/// falls nicht zum Einsatz gehörend.
pub async fn entferne_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
) -> Result<(), AppError> {
    let resultat = sqlx::query("DELETE FROM einsatz_material WHERE id = ? AND einsatz_id = ?")
        .bind(em_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Pool-Wrapper: entfernt eine Dispositionszeile in einer eigenen Connection
/// (delegiert an [`entferne_tx`]).
pub async fn entferne(pool: &SqlitePool, einsatz_id: i64, em_id: i64) -> Result<(), AppError> {
    let mut conn = pool.acquire().await?;
    entferne_tx(&mut conn, einsatz_id, em_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::material::repo::{self as mat_repo, MaterialDaten};
    use crate::material::MaterialStatus;

    /// Org(1) + Benutzer + Einsatz; liefert (benutzer, einsatz).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer, einsatz)
    }

    fn mat_daten(bezeichnung: &str) -> MaterialDaten<'_> {
        MaterialDaten {
            bezeichnung,
            kategorie: Some("Betreuung"),
            bestandsnummer: None,
            traegerorganisation: None,
            standort: None,
            bemerkung: None,
        }
    }

    #[tokio::test]
    async fn disponiere_stamm_fuellt_snapshot_und_default_status() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();

        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.bezeichnung, "Wolldecke");
        assert_eq!(a.menge, 50);
        assert_eq!(a.status, MaterialStatus::Einsatzbereit);
        assert!(!a.ist_adhoc);
        assert_eq!(a.kategorie.as_deref(), Some("Betreuung"));
    }

    #[tokio::test]
    async fn disponiere_stamm_mehrfach_erlaubt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        disponiere_stamm(&pool, einsatz, 1, m.id, 30, benutzer)
            .await
            .unwrap();
        disponiere_stamm(&pool, einsatz, 1, m.id, 20, benutzer)
            .await
            .unwrap();
        assert_eq!(
            liste(&pool, einsatz, true).await.unwrap().len(),
            2,
            "kein UNIQUE - Mengen-Splitting"
        );
    }

    #[tokio::test]
    async fn disponiere_stamm_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')")
            .execute(&pool)
            .await
            .unwrap();
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO material (org_id, bezeichnung) VALUES (2, 'Fremd-Decke') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fremd, 1, benutzer)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_ausser_dienst_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        mat_repo::setze_dienststatus(&pool, 1, m.id, false)
            .await
            .unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, m.id, 1, benutzer)
                .await
                .unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn adhoc_ohne_stamm() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let em = disponiere_adhoc(
            &pool,
            einsatz,
            AdhocDaten {
                bezeichnung: "Spende-Decken",
                kategorie: None,
                bestandsnummer: None,
                traegerorganisation: Some("THW"),
            },
            100,
            benutzer,
        )
        .await
        .unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert!(a.ist_adhoc && a.material_id.is_none());
        assert_eq!(a.menge, 100);
        assert_eq!(a.traegerorganisation.as_deref(), Some("THW"));
    }

    #[tokio::test]
    async fn aktualisiere_menge_status_bemerkung_dann_entferne() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();

        aktualisiere(
            &pool,
            einsatz,
            em,
            Some(30),
            Some(MaterialStatus::Defekt.as_str()),
            Some("nass"),
            None,
        )
        .await
        .unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.menge, 30);
        assert_eq!(a.status, MaterialStatus::Defekt);
        assert_eq!(a.bemerkung.as_deref(), Some("nass"));

        // Nur Status ändern (menge/bemerkung None -> bleiben).
        aktualisiere(
            &pool,
            einsatz,
            em,
            None,
            Some(MaterialStatus::Verbraucht.as_str()),
            None,
            None,
        )
        .await
        .unwrap();
        let b = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(b.menge, 30, "Menge unveraendert");
        assert_eq!(b.status, MaterialStatus::Verbraucht);

        entferne(&pool, einsatz, em).await.unwrap();
        assert!(matches!(
            laden_anzeige(&pool, einsatz, em, true).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn aktualisiere_setzt_uhs_id_und_loese() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();
        let u: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'behandlungsplatz', 'BHP 50', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .bind(benutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        // Zuordnen:
        aktualisiere(&pool, einsatz, em, None, None, None, Some(Some(u)))
            .await
            .unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.uhs_id, Some(u));
        // Lösen (explizit NULL):
        aktualisiere(&pool, einsatz, em, None, None, None, Some(None))
            .await
            .unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert!(a.uhs_id.is_none());
        // liste_je_uhs:
        aktualisiere(&pool, einsatz, em, None, None, None, Some(Some(u)))
            .await
            .unwrap();
        let liste = liste_je_uhs(&pool, einsatz, u, true).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].id, em);
    }

    #[tokio::test]
    async fn snapshot_stabil_live_vs_snapshot() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();

        // Stamm nachträglich umbenennen.
        mat_repo::aktualisiere(&pool, 1, m.id, mat_daten("Wolldecke NEU"))
            .await
            .unwrap();

        // Aktiver Einsatz + in Dienst -> Live (neuer Name); menge/status aus der Zeile.
        let live = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(live.bezeichnung, "Wolldecke NEU");
        assert_eq!(live.menge, 50);

        // Abgeschlossener Einsatz (einsatz_aktiv=false) -> Snapshot (alter Name).
        let snap = laden_anzeige(&pool, einsatz, em, false).await.unwrap();
        assert_eq!(snap.bezeichnung, "Wolldecke");

        // Stamm außer Dienst -> auch bei aktivem Einsatz Snapshot.
        mat_repo::setze_dienststatus(&pool, 1, m.id, false)
            .await
            .unwrap();
        let nach_ad = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(
            nach_ad.bezeichnung, "Wolldecke",
            "ausser Dienst -> Snapshot trotz aktivem Einsatz"
        );
    }
}
