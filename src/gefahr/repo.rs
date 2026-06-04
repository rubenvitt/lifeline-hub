use super::GefahrBewertungAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Eingabedaten für eine Bewertung (durch den Handler validiert/normalisiert).
#[derive(Debug)]
pub struct BewertungDaten<'a> {
    pub gefahrentyp: &'a str,
    pub schutzobjekt: &'a str,
    pub warnstufe: &'a str,
    pub beschreibung: Option<&'a str>,
    pub gemeldet_von: Option<&'a str>,
    pub aktualisiert_von: i64,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, gefahrentyp, schutzobjekt, warnstufe, beschreibung, \
           gemeldet_von, aktualisiert_von, erstellt_at, geaendert_at \
    FROM gefahr_bewertung";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    gefahrentyp: String,
    schutzobjekt: String,
    warnstufe: String,
    beschreibung: Option<String>,
    gemeldet_von: Option<String>,
    aktualisiert_von: i64,
    erstellt_at: String,
    geaendert_at: String,
}

fn zu_anzeige(r: Row) -> GefahrBewertungAnzeige {
    GefahrBewertungAnzeige {
        id: r.id,
        einsatz_id: r.einsatz_id,
        gefahrentyp: r.gefahrentyp,
        schutzobjekt: r.schutzobjekt,
        warnstufe: r.warnstufe,
        beschreibung: r.beschreibung,
        gemeldet_von: r.gemeldet_von,
        aktualisiert_von: r.aktualisiert_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}

/// Alle gesetzten Zellen eines Einsatzes (ohne `warnstufe='keine'` → kein Phantom),
/// stabil sortiert für deterministische Tests/Anzeige.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<GefahrBewertungAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? AND warnstufe != 'keine' \
         ORDER BY gefahrentyp, schutzobjekt"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Aktuelle Warnstufe einer Zelle (für die ETB-Entscheidung *vor* dem Schreiben).
/// `None`, wenn die Zelle noch nicht existiert (= effektiv `keine`).
pub async fn aktuelle_warnstufe(
    pool: &SqlitePool,
    einsatz_id: i64,
    gefahrentyp: &str,
    schutzobjekt: &str,
) -> Result<Option<String>, AppError> {
    let w = sqlx::query_scalar::<_, String>(
        "SELECT warnstufe FROM gefahr_bewertung \
         WHERE einsatz_id = ? AND gefahrentyp = ? AND schutzobjekt = ?",
    )
    .bind(einsatz_id)
    .bind(gefahrentyp)
    .bind(schutzobjekt)
    .fetch_optional(pool)
    .await?;
    Ok(w)
}

/// UPSERT einer Bewertung auf die UNIQUE-Zelle. KEIN Delete-Zweig: `warnstufe='keine'`
/// lässt die Zeile bestehen, `liste()` filtert sie aus → kein Phantom-Eintrag.
pub async fn upsert_bewertung(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: BewertungDaten<'_>,
) -> Result<GefahrBewertungAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO gefahr_bewertung \
            (einsatz_id, gefahrentyp, schutzobjekt, warnstufe, beschreibung, gemeldet_von, aktualisiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT (einsatz_id, gefahrentyp, schutzobjekt) DO UPDATE SET \
            warnstufe = excluded.warnstufe, \
            beschreibung = excluded.beschreibung, \
            gemeldet_von = excluded.gemeldet_von, \
            aktualisiert_von = excluded.aktualisiert_von, \
            geaendert_at = datetime('now') \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.gefahrentyp)
    .bind(daten.schutzobjekt)
    .bind(daten.warnstufe)
    .bind(daten.beschreibung)
    .bind(daten.gemeldet_von)
    .bind(daten.aktualisiert_von)
    .fetch_one(pool)
    .await?;
    laden(pool, id).await
}

/// Stellt sicher, dass für `(typ, objekt)` eine Zelle existiert (für die Zonen-
/// Verknüpfung in Phase 3). Legt sie bei Bedarf mit `warnstufe='keine'` an.
/// Hinweis: bei lifeline gibt es keinen FK Zone→Zelle (anders als BLH ADR-010), die
/// Zone trägt typ/objekt selbst — diese Funktion ist daher fast redundant, bleibt aber
/// per Spec erhalten (idempotent durch ON CONFLICT DO NOTHING).
pub async fn lazy_create_zelle(
    pool: &SqlitePool,
    einsatz_id: i64,
    gefahrentyp: &str,
    schutzobjekt: &str,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO gefahr_bewertung (einsatz_id, gefahrentyp, schutzobjekt, warnstufe, aktualisiert_von) \
         VALUES (?, ?, ?, 'keine', ?) \
         ON CONFLICT (einsatz_id, gefahrentyp, schutzobjekt) DO NOTHING",
    )
    .bind(einsatz_id)
    .bind(gefahrentyp)
    .bind(schutzobjekt)
    .bind(benutzer_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Lädt eine Zelle per id (für die Anzeige nach Upsert).
async fn laden(pool: &SqlitePool, id: i64) -> Result<GefahrBewertungAnzeige, AppError> {
    sqlx::query_as::<_, Row>(&format!("{SELECT_ALLE} WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(zu_anzeige)
        .ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org(1) + Benutzer(1) + Einsatz; liefert einsatz_id und benutzer_id.
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let bid: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'A', 'a', 'x') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let eid: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (eid, bid)
    }

    fn daten<'a>(typ: &'a str, objekt: &'a str, warn: &'a str, bid: i64) -> BewertungDaten<'a> {
        BewertungDaten { gefahrentyp: typ, schutzobjekt: objekt, warnstufe: warn, beschreibung: None, gemeldet_von: None, aktualisiert_von: bid }
    }

    #[tokio::test]
    async fn liste_leer_dann_upsert_dann_aktualisiert() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = setup(&pool).await;
        assert!(liste(&pool, eid).await.unwrap().is_empty());

        let z = upsert_bewertung(&pool, eid, daten("brand", "menschen", "hoch", bid)).await.unwrap();
        assert_eq!(z.warnstufe, "hoch");
        assert_eq!(liste(&pool, eid).await.unwrap().len(), 1);

        // Erneutes Upsert derselben Zelle → Update statt zweiter Zeile.
        let z2 = upsert_bewertung(&pool, eid, daten("brand", "menschen", "akut", bid)).await.unwrap();
        assert_eq!(z2.id, z.id);
        assert_eq!(z2.warnstufe, "akut");
        assert_eq!(liste(&pool, eid).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn warnstufe_keine_ist_kein_phantom() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = setup(&pool).await;
        upsert_bewertung(&pool, eid, daten("brand", "menschen", "hoch", bid)).await.unwrap();
        upsert_bewertung(&pool, eid, daten("brand", "menschen", "keine", bid)).await.unwrap();
        assert!(liste(&pool, eid).await.unwrap().is_empty(), "keine-Zelle darf nicht gelistet werden");
    }

    #[tokio::test]
    async fn aktuelle_warnstufe_liest_vorzustand() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = setup(&pool).await;
        assert_eq!(aktuelle_warnstufe(&pool, eid, "brand", "menschen").await.unwrap(), None);
        upsert_bewertung(&pool, eid, daten("brand", "menschen", "mittel", bid)).await.unwrap();
        assert_eq!(aktuelle_warnstufe(&pool, eid, "brand", "menschen").await.unwrap().as_deref(), Some("mittel"));
    }

    #[tokio::test]
    async fn lazy_create_ist_idempotent_und_keine() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = setup(&pool).await;
        lazy_create_zelle(&pool, eid, "brand", "menschen", bid).await.unwrap();
        lazy_create_zelle(&pool, eid, "brand", "menschen", bid).await.unwrap();
        // keine-Zelle → nicht gelistet, aber existiert (aktuelle_warnstufe == keine).
        assert!(liste(&pool, eid).await.unwrap().is_empty());
        assert_eq!(aktuelle_warnstufe(&pool, eid, "brand", "menschen").await.unwrap().as_deref(), Some("keine"));
    }
}
