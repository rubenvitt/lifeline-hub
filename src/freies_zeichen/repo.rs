use super::FreiesZeichenAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Felder zum Anlegen eines freien Zeichens (durch den Handler validiert/normalisiert).
#[derive(Debug)]
pub struct ZeichenNeu<'a> {
    pub lat: f64,
    pub lon: f64,
    pub zeichen_spec: &'a str,
    pub label: Option<&'a str>,
    /// Ansichts-Zugehörigkeit: `None` = auf allen Ansichten sichtbar.
    pub ansicht_id: Option<i64>,
    pub erstellt_von: i64,
}

/// Teil-Patch (Tri-State): äußere `Option` = „im Patch?“; bei nullable Spalten setzt
/// `Some(None)` NULL. lat/lon sind nicht verschiebbar und fehlen hier. `zeichen_spec` ist Pflicht
/// in der Tabelle und deshalb nur setzbar, nicht leerbar.
#[derive(Debug, Default)]
pub struct ZeichenPatch<'a> {
    pub zeichen_spec: Option<&'a str>,
    pub label: Option<Option<&'a str>>,
    /// Verschieben/Freigeben: `None` = unverändert, `Some(None)` = auf alle Ansichten (NULL),
    /// `Some(Some(x))` = auf Ansicht x.
    pub ansicht_id: Option<Option<i64>>,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, lat, lon, zeichen_spec, label, ansicht_id, erstellt_von, erstellt_at, \
           geaendert_at \
    FROM freies_zeichen";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    lat: f64,
    lon: f64,
    zeichen_spec: String,
    label: Option<String>,
    ansicht_id: Option<i64>,
    erstellt_von: i64,
    erstellt_at: String,
    geaendert_at: String,
}

fn zu_anzeige(r: Row) -> FreiesZeichenAnzeige {
    FreiesZeichenAnzeige {
        id: r.id,
        einsatz_id: r.einsatz_id,
        lat: r.lat,
        lon: r.lon,
        zeichen_spec: r.zeichen_spec,
        label: r.label,
        ansicht_id: r.ansicht_id,
        erstellt_von: r.erstellt_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}

/// Alle freien Zeichen eines Einsatzes, älteste zuerst. `ansicht = Some(x)` liefert die Zeichen
/// der Ansicht x PLUS die ansichtslosen; `None` liefert alles.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    ansicht: Option<i64>,
) -> Result<Vec<FreiesZeichenAnzeige>, AppError> {
    let sql = match ansicht {
        Some(_) => format!(
            "{SELECT_ALLE} WHERE einsatz_id = ? AND (ansicht_id IS NULL OR ansicht_id = ?) ORDER BY id"
        ),
        None => format!("{SELECT_ALLE} WHERE einsatz_id = ? ORDER BY id"),
    };
    let mut q = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(sql)).bind(einsatz_id);
    if let Some(a) = ansicht {
        q = q.bind(a);
    }
    let rows = q.fetch_all(pool).await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Lädt ein Zeichen; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<FreiesZeichenAnzeige, AppError> {
    sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .map(zu_anzeige)
    .ok_or(AppError::NotFound)
}

/// Legt ein Zeichen an (Felder bereits validiert). Liefert die Anzeige.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: ZeichenNeu<'_>,
) -> Result<FreiesZeichenAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO freies_zeichen \
            (einsatz_id, lat, lon, zeichen_spec, label, ansicht_id, erstellt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.lat)
    .bind(daten.lon)
    .bind(daten.zeichen_spec)
    .bind(daten.label)
    .bind(daten.ansicht_id)
    .bind(daten.erstellt_von)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

/// Teil-Patch von Zeichenbeschreibung, `label` und Ansicht; `geaendert_at` wird immer
/// nachgezogen, lat/lon bleiben. `NotFound`, falls fremd/unbekannt.
///
/// Flag/Wert-Paare statt Vollersatz: ein `{"label":"X"}`-Patch lässt die Zeichenbeschreibung
/// stehen (auch die Hülle einer Altzeile, LLH-1160), und `null` bleibt als Leerwunsch der
/// nullable Spalten verfügbar. Nummerierte Parameter, damit eine verschobene Bind-Kette nicht
/// still vertauscht (`patche_setzt_jede_spalte_an_ihren_platz`).
pub async fn patche(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    patch: ZeichenPatch<'_>,
) -> Result<FreiesZeichenAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE freies_zeichen SET \
            zeichen_spec = COALESCE(?1, zeichen_spec), \
            label = CASE WHEN ?2 IS NULL THEN label ELSE ?3 END, \
            ansicht_id = CASE WHEN ?4 IS NULL THEN ansicht_id ELSE ?5 END, \
            geaendert_at = datetime('now') \
         WHERE id = ?6 AND einsatz_id = ?7",
    )
    .bind(patch.zeichen_spec)
    .bind(patch.label.map(|_| 1_i64))
    .bind(patch.label.and_then(|v| v))
    .bind(patch.ansicht_id.map(|_| 1_i64))
    .bind(patch.ansicht_id.and_then(|v| v))
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Hard-Delete. `NotFound`, falls nicht zum Einsatz.
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    laden(pool, einsatz_id, id).await?;
    sqlx::query("DELETE FROM freies_zeichen WHERE id = ? AND einsatz_id = ?")
        .bind(id)
        .bind(einsatz_id)
        .execute(pool)
        .await?;
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

    const SPEC: &str = r#"{"v":1,"freestanding":{"kind":"state","state":"developed-fire"}}"#;
    const SPEC_2: &str = r#"{"v":1,"spec":{"kind":"formation","organization":"feuerwehr"}}"#;

    fn neu(von: i64) -> ZeichenNeu<'static> {
        ZeichenNeu {
            lat: 50.1,
            lon: 8.6,
            zeichen_spec: SPEC,
            label: Some("A"),
            ansicht_id: None,
            erstellt_von: von,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden_roundtrip() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert_eq!(z.einsatz_id, einsatz);
        assert_eq!(z.zeichen_spec, SPEC);
        assert_eq!(z.label.as_deref(), Some("A"));
        assert_eq!(z.lat, 50.1);
        assert_eq!(z.lon, 8.6);
        let geladen = laden(&pool, einsatz, z.id).await.unwrap();
        assert_eq!(geladen, z);
    }

    #[tokio::test]
    async fn liste_ordnet_nach_id() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let a = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let b = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let liste = liste(&pool, einsatz, None).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].id, a.id);
        assert_eq!(liste[1].id, b.id);
    }

    #[tokio::test]
    async fn laden_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert!(matches!(
            laden(&pool, 999, z.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    /// Bind-Reihenfolge: alle Spalten in EINEM Patch auf distinkte Werte setzen und einzeln
    /// prüfen; lat/lon bleiben unberührt.
    #[tokio::test]
    async fn patche_setzt_jede_spalte_an_ihren_platz() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let ansicht: i64 = sqlx::query_scalar(
            "INSERT INTO karten_ansicht (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let n = patche(
            &pool,
            einsatz,
            z.id,
            ZeichenPatch {
                zeichen_spec: Some(SPEC_2),
                label: Some(Some("B")),
                ansicht_id: Some(Some(ansicht)),
            },
        )
        .await
        .unwrap();
        assert_eq!(n.zeichen_spec, SPEC_2);
        assert_eq!(n.label.as_deref(), Some("B"));
        assert_eq!(n.ansicht_id, Some(ansicht));
        assert_eq!((n.lat, n.lon), (z.lat, z.lon));
        assert_eq!(laden(&pool, einsatz, z.id).await.unwrap(), n);
    }

    /// Ein Patch fasst NUR die gesendeten Spalten an; der `Default`-Patch lässt die Zeile
    /// unverändert, `Some(None)` leert die Bezeichnung.
    #[tokio::test]
    async fn patche_laesst_nicht_gesendete_spalten_stehen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let n = patche(
            &pool,
            einsatz,
            z.id,
            ZeichenPatch {
                label: Some(Some("B")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(n.label.as_deref(), Some("B"));
        assert_eq!(n.zeichen_spec, SPEC, "unberührt");

        let unveraendert = patche(&pool, einsatz, z.id, ZeichenPatch::default())
            .await
            .unwrap();
        assert_eq!(unveraendert.label.as_deref(), Some("B"));
        assert_eq!(unveraendert.zeichen_spec, SPEC);

        let geleert = patche(
            &pool,
            einsatz,
            z.id,
            ZeichenPatch {
                label: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(geleert.label, None);
        assert_eq!(
            geleert.zeichen_spec, SPEC,
            "Leerwunsch der Bezeichnung lässt die Form"
        );
    }

    /// Ein Zeichen über einen fremden Einsatz zu patchen bleibt `NotFound`.
    #[tokio::test]
    async fn patche_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert!(matches!(
            patche(
                &pool,
                999,
                z.id,
                ZeichenPatch {
                    zeichen_spec: Some(SPEC_2),
                    ..Default::default()
                },
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
        assert_eq!(laden(&pool, einsatz, z.id).await.unwrap(), z, "unverändert");
    }

    #[tokio::test]
    async fn loeschen_dann_laden_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        loese_auf(&pool, einsatz, z.id).await.unwrap();
        assert!(matches!(
            laden(&pool, einsatz, z.id).await.unwrap_err(),
            AppError::NotFound
        ));
        // Fremd-Delete ebenfalls NotFound.
        let z2 = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert!(matches!(
            loese_auf(&pool, 999, z2.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }
}
