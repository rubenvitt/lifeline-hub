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

/// Editierbare Felder eines PATCH. `None` = unverändert; `Some(None)` = auf NULL.
/// `typ` ist nicht nullable → schlichtes `Option`.
#[derive(Debug, Default)]
pub struct ZonePatch<'a> {
    pub typ: Option<&'a str>,
    pub label: Option<Option<&'a str>>,
    pub farbe: Option<Option<&'a str>>,
    pub notiz: Option<Option<&'a str>>,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, \
           erstellt_von, erstellt_at, geaendert_at \
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
        erstellt_von: r.erstellt_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}

/// Alle Zonen eines Einsatzes, älteste zuerst.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<LageZoneAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? ORDER BY id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool).await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Lädt eine Zone; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<LageZoneAnzeige, AppError> {
    sqlx::query_as::<_, Row>(&format!("{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"))
        .bind(id).bind(einsatz_id)
        .fetch_optional(pool).await?
        .map(zu_anzeige)
        .ok_or(AppError::NotFound)
}

/// Legt eine Zone an (Felder bereits validiert). Liefert die Anzeige.
pub async fn anlegen(pool: &SqlitePool, einsatz_id: i64, daten: ZoneNeu<'_>) -> Result<LageZoneAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lage_zone \
            (einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, erstellt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.typ).bind(daten.geometrie_typ).bind(daten.geometrie)
    .bind(daten.label).bind(daten.farbe).bind(daten.notiz).bind(daten.erstellt_von)
    .fetch_one(pool).await?;
    laden(pool, einsatz_id, id).await
}

/// Partial-Update gegen den Effektivzustand (nur gesendete Felder ändern), `geaendert_at`
/// stets aktualisiert. Geometrie ist NICHT änderbar (kein Reshape). `NotFound`, falls fremd.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    daten: ZonePatch<'_>,
) -> Result<LageZoneAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE lage_zone SET \
            typ   = CASE WHEN ? THEN ? ELSE typ END, \
            label = CASE WHEN ? THEN ? ELSE label END, \
            farbe = CASE WHEN ? THEN ? ELSE farbe END, \
            notiz = CASE WHEN ? THEN ? ELSE notiz END, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.typ.is_some()).bind(daten.typ)
    .bind(daten.label.is_some()).bind(daten.label.flatten())
    .bind(daten.farbe.is_some()).bind(daten.farbe.flatten())
    .bind(daten.notiz.is_some()).bind(daten.notiz.flatten())
    .bind(id).bind(einsatz_id)
    .execute(pool).await?.rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Hard-Delete. `NotFound`, falls nicht zum Einsatz.
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let betroffen = sqlx::query("DELETE FROM lage_zone WHERE id = ? AND einsatz_id = ?")
        .bind(id).bind(einsatz_id)
        .execute(pool).await?.rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org + Benutzer + Einsatz; liefert (einsatz_id, benutzer_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, benutzername, passwort_hash, anzeigename) \
             VALUES (1, 'tester', 'x', 'Tester') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (einsatz, benutzer)
    }

    const POLY: &str = r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
    const LINE: &str = r#"{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}"#;

    #[tokio::test]
    async fn anlegen_und_laden_polygon() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY,
            label: Some("Chemie Halle 3"), farbe: None, notiz: None, erstellt_von: von,
        }).await.unwrap();
        assert_eq!(z.typ, "gefahrengebiet");
        assert_eq!(z.geometrie_typ, "Polygon");
        assert_eq!(z.label.as_deref(), Some("Chemie Halle 3"));
        assert_eq!(z.farbe, None);
        let geladen = laden(&pool, einsatz, z.id).await.unwrap();
        assert_eq!(geladen, z);
    }

    #[tokio::test]
    async fn freie_skizze_linie_mit_farbe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "freie_skizze", geometrie_typ: "LineString", geometrie: LINE,
            label: None, farbe: Some("#00ff00"), notiz: None, erstellt_von: von,
        }).await.unwrap();
        assert_eq!(z.farbe.as_deref(), Some("#00ff00"));
        assert_eq!(z.geometrie_typ, "LineString");
    }

    #[tokio::test]
    async fn patch_merged_und_nullt_nichts_ungewollt() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY,
            label: Some("A"), farbe: None, notiz: Some("Notiz bleibt"), erstellt_von: von,
        }).await.unwrap();
        // Nur label ändern; notiz NICHT mitsenden → bleibt erhalten.
        let n = aktualisiere(&pool, einsatz, z.id, ZonePatch {
            label: Some(Some("B")), ..Default::default()
        }).await.unwrap();
        assert_eq!(n.label.as_deref(), Some("B"));
        assert_eq!(n.notiz.as_deref(), Some("Notiz bleibt"));
    }

    #[tokio::test]
    async fn loeschen_und_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "absperrgrenze", geometrie_typ: "LineString", geometrie: LINE,
            label: None, farbe: None, notiz: None, erstellt_von: von,
        }).await.unwrap();
        assert!(matches!(laden(&pool, 999, z.id).await.unwrap_err(), AppError::NotFound));
        loese_auf(&pool, einsatz, z.id).await.unwrap();
        assert!(matches!(laden(&pool, einsatz, z.id).await.unwrap_err(), AppError::NotFound));
    }
}
