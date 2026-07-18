use super::PersonAnzeige;
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, registrier_nr, status, name, vorname, geschlecht, \
           geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
           melder_kontakt, notiz, erfasst_at, erfasst_von, geaendert_at, \
           geaendert_von, storniert_at, \
           aktuelle_sichtung, aktuelle_sichtung_at, aktueller_verbleib, \
           aktuelle_uhs_id, aktueller_platz_id \
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
    Ok(
        sqlx::query_as::<_, PersonAnzeige>(sqlx::AssertSqlSafe(&*sql))
            .bind(einsatz_id)
            .bind(status)
            .fetch_all(pool)
            .await?,
    )
}

/// Lädt eine Person (auch stornierte) eines Einsatzes; `NotFound`, falls sie
/// nicht zu diesem Einsatz gehört.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<PersonAnzeige, AppError> {
    sqlx::query_as::<_, PersonAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Wie [`laden`], aber auf einer offenen Connection/Transaktion (für den In-Tx-Reload
/// beim atomaren Anlegen — liefert die frische Anzeige samt geparster Felder für ETB-Text
/// und Response in EINER Tx). Mustergleich zu `tier::repo::laden_tx`.
pub async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
) -> Result<PersonAnzeige, AppError> {
    sqlx::query_as::<_, PersonAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt eine Person an (Status `erfasst`) INNERHALB einer offenen Transaktion (F06/LFH-244,
/// Tier-A: atomar mit dem System-ETB-Eintrag). Vergibt `registrier_nr` atomar als
/// `COALESCE(MAX(registrier_nr),0)+1` je Einsatz — zählt stornierte mit, damit keine Nummern
/// recycelt werden. `UNIQUE(einsatz_id, registrier_nr)` sichert ab. Liefert
/// `(id, registrier_nr)` — die `registrier_nr` wird für die ETB-Spur gebraucht und ist erst
/// nach dem INSERT bekannt. Mustergleich zu `tier::repo::anlegen_tx`.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<(i64, i64), AppError> {
    let row: (i64, i64) = sqlx::query_as(
        "INSERT INTO einsatz_person \
            (einsatz_id, registrier_nr, status, name, vorname, geschlecht, \
             geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
             melder_kontakt, notiz, erfasst_von, geaendert_von) \
         SELECT ?1, COALESCE(MAX(registrier_nr), 0) + 1, 'erfasst', ?2, ?3, ?4, \
                ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11 \
         FROM einsatz_person WHERE einsatz_id = ?1 \
         RETURNING id, registrier_nr",
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
    .fetch_one(&mut *conn)
    .await?;
    Ok(row)
}

/// Pool-Wrapper: legt an (eigene Tx) und lädt die Anzeige. Delegiert an [`anlegen_tx`].
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<PersonAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    let (id, _) = anlegen_tx(&mut conn, einsatz_id, erfasser_id, daten).await?;
    drop(conn);
    laden(pool, einsatz_id, id).await
}

/// Aktualisiert Identitäts-/Kontextfelder (COALESCE: nur gesetzte Felder).
/// Setzt `geaendert_at`/`geaendert_von`. `NotFound`, falls nicht zum Einsatz.
///
/// Optimistisches Lock (LFH-241/F10): trägt der Aufrufer `erwartet_geaendert_at` (den beim
/// Laden gelesenen Stand), schreibt das UPDATE nur, solange `geaendert_at` unverändert ist —
/// sonst `Conflict` (409) statt eines stillen Last-write-wins-Overwrites. `None` = bewusstes
/// Overwrite (Escape-Hatch des Konfliktdialogs). Bei 0 betroffenen Zeilen wird 404 (Zeile fehlt)
/// von 409 (Zeile existiert, Stand veraltet) unterschieden.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    geaendert_von: i64,
    erwartet_geaendert_at: Option<&str>,
    daten: PatchDaten<'_>,
) -> Result<PersonAnzeige, AppError> {
    let mut sql = String::from(
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
    );
    if erwartet_geaendert_at.is_some() {
        sql.push_str(" AND geaendert_at = ?");
    }
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql))
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
        .bind(einsatz_id);
    if let Some(stand) = erwartet_geaendert_at {
        q = q.bind(stand);
    }
    let betroffen = q.execute(pool).await?.rows_affected();
    if betroffen == 0 {
        // Mit Guard: existiert die Zeile → veralteter Stand (409), sonst fehlt sie (404).
        if erwartet_geaendert_at.is_some() {
            let existiert: Option<i64> =
                sqlx::query_scalar("SELECT 1 FROM einsatz_person WHERE id = ? AND einsatz_id = ?")
                    .bind(person_id)
                    .bind(einsatz_id)
                    .fetch_optional(pool)
                    .await?;
            if existiert.is_some() {
                return Err(AppError::Conflict(
                    "Der Datensatz wurde zwischenzeitlich geändert. Bitte neu laden.".into(),
                ));
            }
        }
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
    use crate::person::PersonStatus;
    use sqlx::SqlitePool;

    /// Minimal-Setup: eine Org, ein Benutzer, ein aktiver Einsatz. Liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer_id, einsatz_id)
    }

    fn leere_daten<'a>() -> NeueDaten<'a> {
        NeueDaten {
            name: None,
            vorname: None,
            geschlecht: None,
            geburtsdatum: None,
            alter_geschaetzt: None,
            herkunft_adresse: None,
            antreff_ort: None,
            melder_kontakt: None,
            notiz: None,
        }
    }

    #[tokio::test]
    async fn registrier_nr_ist_fortlaufend_und_zaehlt_stornierte_mit() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p1 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        assert_eq!(p1.registrier_nr, 1);
        assert_eq!(p1.status, PersonStatus::Erfasst);
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
        assert!(
            detail.storniert_at.is_some(),
            "Detail liefert stornierte Person mit Zeitstempel"
        );
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
        assert_eq!(vermisste[0].status, PersonStatus::Vermisst);
        let erfasste = liste(&pool, e, Some("erfasst")).await.unwrap();
        assert_eq!(erfasste.len(), 1);
    }

    #[tokio::test]
    async fn anlegen_und_aktualisieren_setzt_felder() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p = anlegen(
            &pool,
            e,
            b,
            NeueDaten {
                name: Some("Mustermann"),
                vorname: Some("Max"),
                geschlecht: Some("maennlich"),
                antreff_ort: Some("Brücke"),
                ..leere_daten()
            },
        )
        .await
        .unwrap();
        assert_eq!(p.name.as_deref(), Some("Mustermann"));
        let aktualisiert = aktualisiere(
            &pool,
            e,
            p.id,
            b,
            None,
            PatchDaten {
                notiz: Some("blutet"),
                ..PatchDaten::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(aktualisiert.notiz.as_deref(), Some("blutet"));
        assert_eq!(
            aktualisiert.name.as_deref(),
            Some("Mustermann"),
            "ungesetzte Felder bleiben"
        );
    }

    /// LFH-241/F10: optimistisches Lock über `geaendert_at`. Deterministische Zeitstempel
    /// (nicht `now`) vermeiden das 1s-Aliasing im Test.
    #[tokio::test]
    async fn aktualisiere_optimistisches_lock_ueber_geaendert_at() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        // Bekannten, klar von „jetzt" verschiedenen Stand setzen.
        sqlx::query("UPDATE einsatz_person SET geaendert_at = '2000-01-01 00:00:00' WHERE id = ?")
            .bind(p.id)
            .execute(&pool)
            .await
            .unwrap();
        let stand = "2000-01-01 00:00:00";

        // Korrekter Stand → Erfolg (und bumpt geaendert_at auf „jetzt").
        aktualisiere(
            &pool,
            e,
            p.id,
            b,
            Some(stand),
            PatchDaten {
                notiz: Some("A"),
                ..PatchDaten::default()
            },
        )
        .await
        .expect("korrekter Stand muss durchgehen");

        // Derselbe (jetzt veraltete) Stand → Conflict, kein Overwrite.
        let err = aktualisiere(
            &pool,
            e,
            p.id,
            b,
            Some(stand),
            PatchDaten {
                notiz: Some("B"),
                ..PatchDaten::default()
            },
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "veralteter Stand muss 409 (Conflict) sein, war: {err:?}"
        );
        let jetzt = laden(&pool, e, p.id).await.unwrap();
        assert_eq!(
            jetzt.notiz.as_deref(),
            Some("A"),
            "Konflikt darf den Overwrite nicht durchlassen"
        );

        // Ohne Stand (None) = bewusstes Overwrite (Escape-Hatch) → Erfolg.
        aktualisiere(
            &pool,
            e,
            p.id,
            b,
            None,
            PatchDaten {
                notiz: Some("C"),
                ..PatchDaten::default()
            },
        )
        .await
        .expect("None-Stand = Overwrite muss durchgehen");

        // Falsche id trotz Stand → NotFound (nicht Conflict).
        let err = aktualisiere(&pool, e, 999_999, b, Some(stand), PatchDaten::default())
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::NotFound),
            "unbekannte id muss 404 bleiben, war: {err:?}"
        );
    }

    #[tokio::test]
    async fn laden_fremder_einsatz_ist_notfound() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        let err = laden(&pool, 999, p.id).await.unwrap_err();
        assert!(matches!(err, crate::error::AppError::NotFound));
    }

    #[tokio::test]
    async fn neue_person_hat_leeren_med_cache() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        let detail = laden(&pool, e, p.id).await.unwrap();
        assert!(detail.aktuelle_sichtung.is_none(), "ungesichtet = NULL");
        assert!(detail.aktuelle_sichtung_at.is_none());
        assert!(
            detail.aktueller_verbleib.is_none(),
            "kein Verbleib = vor Ort"
        );
    }
}
