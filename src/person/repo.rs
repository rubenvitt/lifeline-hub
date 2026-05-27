use super::PersonAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, registrier_nr, status, name, vorname, geschlecht, \
           geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
           melder_kontakt, notiz, erfasst_at, erfasst_von, geaendert_at, \
           geaendert_von, storniert_at \
    FROM einsatz_person";

/// Eingabedaten beim Anlegen. Strings bereits getrimmt (Handler-Aufgabe);
/// leere Werte sollten als `None` ankommen. Status ist immer `erfasst`.
#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub name: Option<&'a str>,
    pub vorname: Option<&'a str>,
    pub geschlecht: Option<&'a str>,
    pub geburtsdatum: Option<&'a str>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<&'a str>,
    pub antreff_ort: Option<&'a str>,
    pub melder_kontakt: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

/// Patch-Daten: gesetzte Felder werden übernommen, `None` bleibt unverändert
/// (COALESCE-Semantik). Das Löschen eines Feldes auf NULL ist in E‑1 nicht
/// vorgesehen.
#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub name: Option<&'a str>,
    pub vorname: Option<&'a str>,
    pub geschlecht: Option<&'a str>,
    pub geburtsdatum: Option<&'a str>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<&'a str>,
    pub antreff_ort: Option<&'a str>,
    pub melder_kontakt: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

/// Personen eines Einsatzes (ohne stornierte), optional nach Status gefiltert.
/// Sortierung: registrier_nr aufsteigend.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<&str>,
) -> Result<Vec<PersonAnzeige>, AppError> {
    let sql = format!(
        "{SELECT_ALLE} WHERE einsatz_id = ?1 AND storniert_at IS NULL \
         AND (?2 IS NULL OR status = ?2) ORDER BY registrier_nr"
    );
    Ok(sqlx::query_as::<_, PersonAnzeige>(&sql)
        .bind(einsatz_id)
        .bind(status)
        .fetch_all(pool)
        .await?)
}

/// Lädt eine Person (auch stornierte) eines Einsatzes; `NotFound`, falls sie
/// nicht zu diesem Einsatz gehört.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<PersonAnzeige, AppError> {
    sqlx::query_as::<_, PersonAnzeige>(&format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    ))
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt eine Person an (Status `erfasst`), vergibt `registrier_nr` atomar als
/// `COALESCE(MAX(registrier_nr),0)+1` je Einsatz — zählt stornierte mit, damit
/// keine Nummern recycelt werden. `UNIQUE(einsatz_id, registrier_nr)` sichert ab.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<PersonAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_person \
            (einsatz_id, registrier_nr, status, name, vorname, geschlecht, \
             geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
             melder_kontakt, notiz, erfasst_von, geaendert_von) \
         SELECT ?1, COALESCE(MAX(registrier_nr), 0) + 1, 'erfasst', ?2, ?3, ?4, \
                ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11 \
         FROM einsatz_person WHERE einsatz_id = ?1 \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.name)
    .bind(daten.vorname)
    .bind(daten.geschlecht)
    .bind(daten.geburtsdatum)
    .bind(daten.alter_geschaetzt)
    .bind(daten.herkunft_adresse)
    .bind(daten.antreff_ort)
    .bind(daten.melder_kontakt)
    .bind(daten.notiz)
    .bind(erfasser_id)
    .fetch_one(pool)
    .await?;

    laden(pool, einsatz_id, id).await
}

/// Aktualisiert Identitäts-/Kontextfelder (COALESCE: nur gesetzte Felder).
/// Setzt `geaendert_at`/`geaendert_von`. `NotFound`, falls nicht zum Einsatz.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    geaendert_von: i64,
    daten: PatchDaten<'_>,
) -> Result<PersonAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_person SET \
            name = COALESCE(?, name), \
            vorname = COALESCE(?, vorname), \
            geschlecht = COALESCE(?, geschlecht), \
            geburtsdatum = COALESCE(?, geburtsdatum), \
            alter_geschaetzt = COALESCE(?, alter_geschaetzt), \
            herkunft_adresse = COALESCE(?, herkunft_adresse), \
            antreff_ort = COALESCE(?, antreff_ort), \
            melder_kontakt = COALESCE(?, melder_kontakt), \
            notiz = COALESCE(?, notiz), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.name)
    .bind(daten.vorname)
    .bind(daten.geschlecht)
    .bind(daten.geburtsdatum)
    .bind(daten.alter_geschaetzt)
    .bind(daten.herkunft_adresse)
    .bind(daten.antreff_ort)
    .bind(daten.melder_kontakt)
    .bind(daten.notiz)
    .bind(geaendert_von)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, person_id).await
}

/// Setzt den Status (Übergangsvalidierung ist Handler-Aufgabe via
/// `darf_uebergehen`). Setzt `geaendert_at`/`geaendert_von`. `NotFound`, falls
/// nicht zum Einsatz.
pub async fn setze_status(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    neuer_status: &str,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_person SET status = ?, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(neuer_status)
    .bind(geaendert_von)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Soft-Delete (Fehleingabe): setzt `storniert_at`. Bleibt referenzierbar (Audit).
/// `NotFound`, falls nicht zum Einsatz.
pub async fn storniere(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_person SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(geaendert_von)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Minimal-Setup: eine Org, ein Benutzer, ein aktiver Einsatz. Liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id)
    }

    fn leere_daten<'a>() -> NeueDaten<'a> {
        NeueDaten {
            name: None, vorname: None, geschlecht: None, geburtsdatum: None,
            alter_geschaetzt: None, herkunft_adresse: None, antreff_ort: None,
            melder_kontakt: None, notiz: None,
        }
    }

    #[tokio::test]
    async fn registrier_nr_ist_fortlaufend_und_zaehlt_stornierte_mit() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p1 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        assert_eq!(p1.registrier_nr, 1);
        assert_eq!(p1.status, "erfasst");
        storniere(&pool, e, p1.id, b).await.unwrap();
        let p2 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        assert_eq!(p2.registrier_nr, 2, "Soft-Delete recycelt keine Nummern");
    }

    #[tokio::test]
    async fn liste_blendet_stornierte_aus_detail_zeigt_sie() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p1 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        storniere(&pool, e, p1.id, b).await.unwrap();
        let liste = liste(&pool, e, None).await.unwrap();
        assert!(liste.is_empty(), "stornierte Person nicht in der Liste");
        let detail = laden(&pool, e, p1.id).await.unwrap();
        assert!(detail.storniert_at.is_some(), "Detail liefert stornierte Person mit Zeitstempel");
    }

    #[tokio::test]
    async fn liste_filtert_nach_status() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p1 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        setze_status(&pool, e, p1.id, "vermisst", b).await.unwrap();
        let _p2 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        let vermisste = liste(&pool, e, Some("vermisst")).await.unwrap();
        assert_eq!(vermisste.len(), 1);
        assert_eq!(vermisste[0].status, "vermisst");
        let erfasste = liste(&pool, e, Some("erfasst")).await.unwrap();
        assert_eq!(erfasste.len(), 1);
    }

    #[tokio::test]
    async fn anlegen_und_aktualisieren_setzt_felder() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p = anlegen(&pool, e, b, NeueDaten {
            name: Some("Mustermann"), vorname: Some("Max"), geschlecht: Some("maennlich"),
            antreff_ort: Some("Brücke"), ..leere_daten()
        }).await.unwrap();
        assert_eq!(p.name.as_deref(), Some("Mustermann"));
        let aktualisiert = aktualisiere(&pool, e, p.id, b, PatchDaten {
            notiz: Some("blutet"), ..PatchDaten::default()
        }).await.unwrap();
        assert_eq!(aktualisiert.notiz.as_deref(), Some("blutet"));
        assert_eq!(aktualisiert.name.as_deref(), Some("Mustermann"), "ungesetzte Felder bleiben");
    }

    #[tokio::test]
    async fn laden_fremder_einsatz_ist_notfound() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        let err = laden(&pool, 999, p.id).await.unwrap_err();
        assert!(matches!(err, crate::error::AppError::NotFound));
    }
}
