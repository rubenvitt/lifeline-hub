use super::LageZoneAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Felder zum Anlegen einer Zone (durch den Handler validiert/normalisiert).
#[derive(Debug)]
pub struct ZoneNeu<'a> {
    pub typ: &'a str,
    pub geometrie_typ: &'a str,
    pub geometrie: &'a str,
    pub label: Option<&'a str>,
    pub farbe: Option<&'a str>,
    pub notiz: Option<&'a str>,
    pub erstellt_von: i64,
}

/// `None` = unverändert; `Some(None)` = auf NULL/abspalten; `Some(Some(x))` = setzen.
#[derive(Debug, Default)]
pub struct ZonePatch<'a> {
    pub typ: Option<&'a str>,
    pub label: Option<Option<&'a str>>,
    pub farbe: Option<Option<&'a str>>,
    pub notiz: Option<Option<&'a str>>,
    pub gefahrengebiet_id: Option<Option<i64>>,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, \
           gefahrengebiet_id, erstellt_von, erstellt_at, geaendert_at \
    FROM lage_zone";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    typ: String,
    geometrie_typ: String,
    geometrie: String,
    label: Option<String>,
    farbe: Option<String>,
    notiz: Option<String>,
    gefahrengebiet_id: Option<i64>,
    erstellt_von: i64,
    erstellt_at: String,
    geaendert_at: String,
}

fn zu_anzeige(r: Row) -> LageZoneAnzeige {
    LageZoneAnzeige {
        id: r.id,
        einsatz_id: r.einsatz_id,
        typ: r.typ,
        geometrie_typ: r.geometrie_typ,
        geometrie: r.geometrie,
        label: r.label,
        farbe: r.farbe,
        notiz: r.notiz,
        gefahrengebiet_id: r.gefahrengebiet_id,
        erstellt_von: r.erstellt_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}

/// Alle Zonen eines Einsatzes, älteste zuerst.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<LageZoneAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!("{SELECT_ALLE} WHERE einsatz_id = ? ORDER BY id"))
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Lädt eine Zone; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<LageZoneAnzeige, AppError> {
    sqlx::query_as::<_, Row>(&format!("{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .map(zu_anzeige)
        .ok_or(AppError::NotFound)
}

/// Legt eine Zone an (Felder bereits validiert). Liefert die Anzeige.
/// gefahrengebiet-Zonen tragen immer eine Gruppe (Gruppe-von-eins beim Zeichnen);
/// Gruppen-INSERT + Zonen-INSERT laufen atomar, damit keine Ghost-Gruppe zurückbleibt.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: ZoneNeu<'_>,
) -> Result<LageZoneAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    let gebiet_id = if daten.typ == "gefahrengebiet" {
        Some(
            crate::gefahr::repo::gebiet_anlegen(
                &mut *tx,
                einsatz_id,
                daten.label,
                daten.erstellt_von,
            )
            .await?,
        )
    } else {
        None
    };
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lage_zone \
            (einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, gefahrengebiet_id, erstellt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.typ).bind(daten.geometrie_typ).bind(daten.geometrie)
    .bind(daten.label).bind(daten.farbe).bind(daten.notiz).bind(gebiet_id).bind(daten.erstellt_von)
    .fetch_one(&mut *tx).await?;
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Partial-Update gegen den Effektivzustand (nur gesendete Felder ändern), `geaendert_at`
/// stets aktualisiert. Geometrie ist NICHT änderbar (kein Reshape). `NotFound`, falls fremd.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    daten: ZonePatch<'_>,
) -> Result<LageZoneAnzeige, AppError> {
    let vorher = laden(pool, einsatz_id, id).await?;
    let neuer_typ = daten.typ.unwrap_or(&vorher.typ);
    let alt_gebiet = vorher.gefahrengebiet_id;

    // Gruppen-INSERT (Split/Neuanlage) und das anschließende UPDATE laufen atomar,
    // damit nie eine committete Gruppe ohne zugehörige Zone zurückbleibt.
    let mut tx = pool.begin().await?;

    // gefahrengebiet-Zonen tragen IMMER eine Gruppe. `Some(None)` heißt NICHT
    // „Spalte auf NULL", sondern „in NEUE eigene Gruppe abspalten".
    let ziel_gebiet: Option<i64> = if neuer_typ != "gefahrengebiet" {
        None
    } else {
        match daten.gefahrengebiet_id {
            Some(Some(zielid)) => Some(zielid),
            Some(None) => Some(
                crate::gefahr::repo::gebiet_anlegen(
                    &mut *tx,
                    einsatz_id,
                    vorher.label.as_deref(),
                    benutzer_id,
                )
                .await?,
            ),
            None => match alt_gebiet {
                Some(g) => Some(g),
                None => Some(
                    crate::gefahr::repo::gebiet_anlegen(
                        &mut *tx,
                        einsatz_id,
                        vorher.label.as_deref(),
                        benutzer_id,
                    )
                    .await?,
                ),
            },
        }
    };

    let betroffen = sqlx::query(
        "UPDATE lage_zone SET \
            typ   = CASE WHEN ? THEN ? ELSE typ END, \
            label = CASE WHEN ? THEN ? ELSE label END, \
            farbe = CASE WHEN ? THEN ? ELSE farbe END, \
            notiz = CASE WHEN ? THEN ? ELSE notiz END, \
            gefahrengebiet_id = ?, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.typ.is_some())
    .bind(daten.typ)
    .bind(daten.label.is_some())
    .bind(daten.label.flatten())
    .bind(daten.farbe.is_some())
    .bind(daten.farbe.flatten())
    .bind(daten.notiz.is_some())
    .bind(daten.notiz.flatten())
    // ziel_gebiet enthält bereits den Effektivwert (None-Arm = unverändert) → kein CASE nötig.
    .bind(ziel_gebiet)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    tx.commit().await?;

    // Verlassene Gruppe aufräumen, falls jetzt leer (Matrix cascaded mit weg).
    if alt_gebiet != ziel_gebiet {
        if let Some(g) = alt_gebiet {
            crate::gefahr::repo::gebiet_aufraeumen_wenn_leer(pool, g).await?;
        }
    }
    laden(pool, einsatz_id, id).await
}

/// Hard-Delete. `NotFound`, falls nicht zum Einsatz. Verlassene Gruppe aufräumen.
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let z = laden(pool, einsatz_id, id).await?;
    sqlx::query("DELETE FROM lage_zone WHERE id = ? AND einsatz_id = ?")
        .bind(id)
        .bind(einsatz_id)
        .execute(pool)
        .await?;
    if let Some(g) = z.gefahrengebiet_id {
        crate::gefahr::repo::gebiet_aufraeumen_wenn_leer(pool, g).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org + Benutzer + Einsatz; liefert (einsatz_id, benutzer_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, benutzername, passwort_hash, anzeigename) \
             VALUES (1, 'tester', 'x', 'Tester') RETURNING id",
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
        (einsatz, benutzer)
    }

    const POLY: &str =
        r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
    const LINE: &str = r#"{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}"#;

    #[tokio::test]
    async fn anlegen_gefahrengebiet_legt_gruppe_an() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: Some("Chemie Halle 3"),
                farbe: None,
                notiz: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        assert!(
            z.gefahrengebiet_id.is_some(),
            "gefahrengebiet-Zone muss eine Gruppe tragen"
        );
        let geladen = laden(&pool, einsatz, z.id).await.unwrap();
        assert_eq!(geladen, z);
    }

    #[tokio::test]
    async fn anlegen_nicht_gefahrengebiet_ohne_gruppe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "freie_skizze",
                geometrie_typ: "LineString",
                geometrie: LINE,
                label: None,
                farbe: Some("#00ff00"),
                notiz: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        assert!(z.gefahrengebiet_id.is_none());
    }

    #[tokio::test]
    async fn patch_label_merged_und_haelt_notiz() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: Some("A"),
                farbe: None,
                notiz: Some("Notiz bleibt"),
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let n = aktualisiere(
            &pool,
            einsatz,
            z.id,
            von,
            ZonePatch {
                label: Some(Some("B")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(n.label.as_deref(), Some("B"));
        assert_eq!(n.notiz.as_deref(), Some("Notiz bleibt"));
        assert_eq!(
            n.gefahrengebiet_id, z.gefahrengebiet_id,
            "Gruppe bleibt bei reinem Label-PATCH"
        );
    }

    #[tokio::test]
    async fn merge_haengt_um_und_raeumt_leere_quellgruppe_auf() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let a = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: None,
                farbe: None,
                notiz: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let b = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: None,
                farbe: None,
                notiz: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let ziel = b.gefahrengebiet_id.unwrap();
        let quelle = a.gefahrengebiet_id.unwrap();

        let a2 = aktualisiere(
            &pool,
            einsatz,
            a.id,
            von,
            ZonePatch {
                gefahrengebiet_id: Some(Some(ziel)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(a2.gefahrengebiet_id, Some(ziel));
        // Quellgruppe ist leer → aufgeräumt.
        assert!(crate::gefahr::repo::gebiet_laden(&pool, einsatz, quelle)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn loeschen_letzter_zone_entfernt_gruppe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: None,
                farbe: None,
                notiz: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let gid = z.gefahrengebiet_id.unwrap();
        loese_auf(&pool, einsatz, z.id).await.unwrap();
        assert!(crate::gefahr::repo::gebiet_laden(&pool, einsatz, gid)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn typ_wechsel_weg_von_gefahrengebiet_loest_gruppe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: None,
                farbe: None,
                notiz: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let gid = z.gefahrengebiet_id.unwrap();
        let n = aktualisiere(
            &pool,
            einsatz,
            z.id,
            von,
            ZonePatch {
                typ: Some("absperrbereich"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(n.gefahrengebiet_id.is_none());
        assert!(crate::gefahr::repo::gebiet_laden(&pool, einsatz, gid)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn loeschen_und_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "absperrgrenze",
                geometrie_typ: "LineString",
                geometrie: LINE,
                label: None,
                farbe: None,
                notiz: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        assert!(matches!(
            laden(&pool, 999, z.id).await.unwrap_err(),
            AppError::NotFound
        ));
        loese_auf(&pool, einsatz, z.id).await.unwrap();
        assert!(matches!(
            laden(&pool, einsatz, z.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }
}
