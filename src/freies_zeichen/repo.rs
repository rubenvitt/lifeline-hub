use super::FreiesZeichenAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Felder zum Anlegen eines freien Zeichens (durch den Handler validiert/normalisiert).
#[derive(Debug)]
pub struct ZeichenNeu<'a> {
    pub lat: f64,
    pub lon: f64,
    pub grundzeichen: &'a str,
    pub organisation: Option<&'a str>,
    pub fachaufgabe: Option<&'a str>,
    pub symbol: Option<&'a str>,
    pub einheit: Option<&'a str>,
    pub funktion: Option<&'a str>,
    pub farbe: Option<&'a str>,
    pub label: Option<&'a str>,
    pub erstellt_von: i64,
}

/// Whole-Spec-Overwrite: alle TZ-Overlays + label werden gesetzt (fehlt ein Feld → NULL).
/// lat/lon sind NICHT verschiebbar (v1) und daher NICHT Teil des Updates.
#[derive(Debug)]
pub struct ZeichenUpdate<'a> {
    pub grundzeichen: &'a str,
    pub organisation: Option<&'a str>,
    pub fachaufgabe: Option<&'a str>,
    pub symbol: Option<&'a str>,
    pub einheit: Option<&'a str>,
    pub funktion: Option<&'a str>,
    pub farbe: Option<&'a str>,
    pub label: Option<&'a str>,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, lat, lon, grundzeichen, organisation, fachaufgabe, symbol, \
           einheit, funktion, farbe, label, erstellt_von, erstellt_at, geaendert_at \
    FROM freies_zeichen";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    lat: f64,
    lon: f64,
    grundzeichen: String,
    organisation: Option<String>,
    fachaufgabe: Option<String>,
    symbol: Option<String>,
    einheit: Option<String>,
    funktion: Option<String>,
    farbe: Option<String>,
    label: Option<String>,
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
        grundzeichen: r.grundzeichen,
        organisation: r.organisation,
        fachaufgabe: r.fachaufgabe,
        symbol: r.symbol,
        einheit: r.einheit,
        funktion: r.funktion,
        farbe: r.farbe,
        label: r.label,
        erstellt_von: r.erstellt_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}

/// Alle freien Zeichen eines Einsatzes, älteste zuerst.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<FreiesZeichenAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? ORDER BY id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
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
            (einsatz_id, lat, lon, grundzeichen, organisation, fachaufgabe, symbol, \
             einheit, funktion, farbe, label, erstellt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.lat)
    .bind(daten.lon)
    .bind(daten.grundzeichen)
    .bind(daten.organisation)
    .bind(daten.fachaufgabe)
    .bind(daten.symbol)
    .bind(daten.einheit)
    .bind(daten.funktion)
    .bind(daten.farbe)
    .bind(daten.label)
    .bind(daten.erstellt_von)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

/// Whole-Spec-Update aller TZ-Overlays + label + `geaendert_at`. lat/lon bleiben
/// UNVERÄNDERT (kein Verschieben in v1). `NotFound`, falls fremd/unbekannt.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    daten: ZeichenUpdate<'_>,
) -> Result<FreiesZeichenAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE freies_zeichen SET \
            grundzeichen = ?, organisation = ?, fachaufgabe = ?, symbol = ?, \
            einheit = ?, funktion = ?, farbe = ?, label = ?, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.grundzeichen)
    .bind(daten.organisation)
    .bind(daten.fachaufgabe)
    .bind(daten.symbol)
    .bind(daten.einheit)
    .bind(daten.funktion)
    .bind(daten.farbe)
    .bind(daten.label)
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

    fn neu(von: i64) -> ZeichenNeu<'static> {
        ZeichenNeu {
            lat: 50.1,
            lon: 8.6,
            grundzeichen: "einheit",
            organisation: Some("feuerwehr"),
            fachaufgabe: Some("brandbekaempfung"),
            symbol: None,
            einheit: Some("zug"),
            funktion: None,
            farbe: Some("#ff0000"),
            label: Some("A"),
            erstellt_von: von,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden_roundtrip() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert_eq!(z.einsatz_id, einsatz);
        assert_eq!(z.grundzeichen, "einheit");
        assert_eq!(z.organisation.as_deref(), Some("feuerwehr"));
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
        let liste = liste(&pool, einsatz).await.unwrap();
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

    #[tokio::test]
    async fn aktualisiere_whole_spec_haelt_lat_lon() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let n = aktualisiere(
            &pool,
            einsatz,
            z.id,
            ZeichenUpdate {
                grundzeichen: "fahrzeug",
                organisation: Some("thw"),
                fachaufgabe: None,
                symbol: Some("kran"),
                einheit: None,
                funktion: Some("zugtrupp"),
                farbe: None,
                label: Some("B"),
            },
        )
        .await
        .unwrap();
        // Neue Overlay-Werte übernommen …
        assert_eq!(n.grundzeichen, "fahrzeug");
        assert_eq!(n.organisation.as_deref(), Some("thw"));
        assert_eq!(n.symbol.as_deref(), Some("kran"));
        assert_eq!(n.funktion.as_deref(), Some("zugtrupp"));
        assert_eq!(n.label.as_deref(), Some("B"));
        // … fehlende Felder auf NULL (Whole-Spec-Overwrite) …
        assert_eq!(n.fachaufgabe, None);
        assert_eq!(n.einheit, None);
        assert_eq!(n.farbe, None);
        // … lat/lon UNVERÄNDERT.
        assert_eq!(n.lat, z.lat);
        assert_eq!(n.lon, z.lon);
        let geladen = laden(&pool, einsatz, z.id).await.unwrap();
        assert_eq!(geladen, n);
    }

    #[tokio::test]
    async fn aktualisiere_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert!(matches!(
            aktualisiere(
                &pool,
                999,
                z.id,
                ZeichenUpdate {
                    grundzeichen: "einheit",
                    organisation: None,
                    fachaufgabe: None,
                    symbol: None,
                    einheit: None,
                    funktion: None,
                    farbe: None,
                    label: None,
                },
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
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
