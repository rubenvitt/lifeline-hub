use super::{GefahrBewertungAnzeige, Gefahrentyp, GefahrengebietAnzeige, Schutzobjekt, Warnstufe};
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
    SELECT id, gefahrengebiet_id, gefahrentyp, schutzobjekt, warnstufe, beschreibung, \
           gemeldet_von, aktualisiert_von, erstellt_at, geaendert_at \
    FROM gefahr_bewertung";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    gefahrengebiet_id: i64,
    #[sqlx(try_from = "String")]
    gefahrentyp: Gefahrentyp,
    #[sqlx(try_from = "String")]
    schutzobjekt: Schutzobjekt,
    #[sqlx(try_from = "String")]
    warnstufe: Warnstufe,
    beschreibung: Option<String>,
    gemeldet_von: Option<String>,
    aktualisiert_von: i64,
    erstellt_at: String,
    geaendert_at: String,
}

fn zu_anzeige(r: Row) -> GefahrBewertungAnzeige {
    GefahrBewertungAnzeige {
        id: r.id,
        gefahrengebiet_id: r.gefahrengebiet_id,
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

/// Alle gesetzten Zellen eines Gefahrengebiets (ohne `warnstufe='keine'`).
pub async fn liste(
    pool: &SqlitePool,
    gefahrengebiet_id: i64,
) -> Result<Vec<GefahrBewertungAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE gefahrengebiet_id = ? AND warnstufe != 'keine' \
         ORDER BY gefahrentyp, schutzobjekt"
    )))
    .bind(gefahrengebiet_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Aktuelle Warnstufe einer Zelle (für die ETB-Entscheidung *vor* dem Schreiben).
pub async fn aktuelle_warnstufe(
    pool: &SqlitePool,
    gefahrengebiet_id: i64,
    gefahrentyp: &str,
    schutzobjekt: &str,
) -> Result<Option<String>, AppError> {
    let w = sqlx::query_scalar::<_, String>(
        "SELECT warnstufe FROM gefahr_bewertung \
         WHERE gefahrengebiet_id = ? AND gefahrentyp = ? AND schutzobjekt = ?",
    )
    .bind(gefahrengebiet_id)
    .bind(gefahrentyp)
    .bind(schutzobjekt)
    .fetch_optional(pool)
    .await?;
    Ok(w)
}

/// UPSERT einer Bewertung. KEIN Delete-Zweig: `warnstufe='keine'` lässt die Zeile
/// bestehen, `liste()` filtert sie aus.
pub async fn upsert_bewertung(
    pool: &SqlitePool,
    gefahrengebiet_id: i64,
    daten: BewertungDaten<'_>,
) -> Result<GefahrBewertungAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO gefahr_bewertung \
            (gefahrengebiet_id, gefahrentyp, schutzobjekt, warnstufe, beschreibung, gemeldet_von, aktualisiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT (gefahrengebiet_id, gefahrentyp, schutzobjekt) DO UPDATE SET \
            warnstufe = excluded.warnstufe, \
            beschreibung = excluded.beschreibung, \
            gemeldet_von = excluded.gemeldet_von, \
            aktualisiert_von = excluded.aktualisiert_von, \
            geaendert_at = datetime('now') \
         RETURNING id",
    )
    .bind(gefahrengebiet_id)
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

/// Lädt eine Zelle per id (für die Anzeige nach Upsert).
async fn laden(pool: &SqlitePool, id: i64) -> Result<GefahrBewertungAnzeige, AppError> {
    sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!("{SELECT_ALLE} WHERE id = ?")))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(zu_anzeige)
        .ok_or(AppError::NotFound)
}

/// Legt ein leeres Gefahrengebiet an und liefert seine id. Executor-generisch, damit
/// es sowohl mit `&SqlitePool` als auch mit `&mut *tx` (atomar mit dem Zonen-Schreiben)
/// aufgerufen werden kann.
pub async fn gebiet_anlegen(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    label: Option<&str>,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO gefahrengebiet (einsatz_id, label, erstellt_von) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(label)
    .bind(benutzer_id)
    .fetch_one(executor)
    .await?;
    Ok(id)
}

/// Alle Gefahrengebiete eines Einsatzes inkl. zugehöriger Zonen-IDs und höchster
/// Warnstufe (Severity-Maximum; leere Matrix → `keine`).
pub async fn gebiete_liste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<GefahrengebietAnzeige>, AppError> {
    let gruppen = sqlx::query_as::<_, (i64, i64, Option<String>)>(
        "SELECT id, einsatz_id, label FROM gefahrengebiet WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;

    let zonen = sqlx::query_as::<_, (i64, i64)>(
        "SELECT gefahrengebiet_id, id FROM lage_zone \
         WHERE einsatz_id = ? AND gefahrengebiet_id IS NOT NULL ORDER BY id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;

    let raenge = sqlx::query_as::<_, (i64, i64)>(
        "SELECT b.gefahrengebiet_id, \
                MAX(CASE b.warnstufe WHEN 'akut' THEN 4 WHEN 'hoch' THEN 3 \
                    WHEN 'mittel' THEN 2 WHEN 'niedrig' THEN 1 ELSE 0 END) \
         FROM gefahr_bewertung b JOIN gefahrengebiet g ON g.id = b.gefahrengebiet_id \
         WHERE g.einsatz_id = ? GROUP BY b.gefahrengebiet_id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;

    Ok(gruppen
        .into_iter()
        .map(|(id, einsatz_id, label)| {
            let zonen_ids = zonen
                .iter()
                .filter(|(gid, _)| *gid == id)
                .map(|(_, zid)| *zid)
                .collect();
            let rang = raenge
                .iter()
                .find(|(gid, _)| *gid == id)
                .map(|(_, r)| *r)
                .unwrap_or(0);
            GefahrengebietAnzeige {
                id,
                einsatz_id,
                label,
                zonen_ids,
                hoechste_warnstufe: super::warnstufe_von_rang(rang),
            }
        })
        .collect())
}

/// Lädt EIN Gefahrengebiet (Ownership-Gate: `NotFound`, falls nicht zum Einsatz).
pub async fn gebiet_laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    gid: i64,
) -> Result<GefahrengebietAnzeige, AppError> {
    gebiete_liste(pool, einsatz_id)
        .await?
        .into_iter()
        .find(|g| g.id == gid)
        .ok_or(AppError::NotFound)
}

/// Benennt ein Gefahrengebiet um. `NotFound`, falls nicht zum Einsatz.
pub async fn gebiet_umbenennen(
    pool: &SqlitePool,
    einsatz_id: i64,
    gid: i64,
    label: Option<&str>,
) -> Result<GefahrengebietAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE gefahrengebiet SET label = ?, geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(label)
    .bind(gid)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    gebiet_laden(pool, einsatz_id, gid).await
}

/// Löscht ein Gefahrengebiet, falls keine Zone mehr darauf zeigt (idempotent).
/// Die Matrix wird per ON DELETE CASCADE mit entfernt.
pub async fn gebiet_aufraeumen_wenn_leer(pool: &SqlitePool, gid: i64) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM gefahrengebiet WHERE id = ? \
         AND NOT EXISTS (SELECT 1 FROM lage_zone WHERE gefahrengebiet_id = ?)",
    )
    .bind(gid)
    .bind(gid)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::Warnstufe;

    /// Org + Benutzer + Einsatz + EIN Gefahrengebiet; liefert (gefahrengebiet_id, benutzer_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let bid: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'A', 'a', 'x') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let eid: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let gid = gebiet_anlegen(pool, eid, Some("Nord"), bid).await.unwrap();
        (gid, bid)
    }

    fn daten<'a>(typ: &'a str, objekt: &'a str, warn: &'a str, bid: i64) -> BewertungDaten<'a> {
        BewertungDaten {
            gefahrentyp: typ,
            schutzobjekt: objekt,
            warnstufe: warn,
            beschreibung: None,
            gemeldet_von: None,
            aktualisiert_von: bid,
        }
    }

    #[tokio::test]
    async fn liste_leer_dann_upsert_dann_aktualisiert() {
        let pool = crate::db::test_pool().await;
        let (gid, bid) = setup(&pool).await;
        assert!(liste(&pool, gid).await.unwrap().is_empty());

        let z = upsert_bewertung(&pool, gid, daten("brand", "menschen", "hoch", bid))
            .await
            .unwrap();
        assert_eq!(z.warnstufe, Warnstufe::Hoch);
        assert_eq!(z.gefahrengebiet_id, gid);
        assert_eq!(liste(&pool, gid).await.unwrap().len(), 1);

        let z2 = upsert_bewertung(&pool, gid, daten("brand", "menschen", "akut", bid))
            .await
            .unwrap();
        assert_eq!(z2.id, z.id);
        assert_eq!(z2.warnstufe, Warnstufe::Akut);
        assert_eq!(liste(&pool, gid).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn warnstufe_keine_ist_kein_phantom() {
        let pool = crate::db::test_pool().await;
        let (gid, bid) = setup(&pool).await;
        upsert_bewertung(&pool, gid, daten("brand", "menschen", "hoch", bid))
            .await
            .unwrap();
        upsert_bewertung(&pool, gid, daten("brand", "menschen", "keine", bid))
            .await
            .unwrap();
        assert!(liste(&pool, gid).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn gebiete_liste_liefert_hoechste_warnstufe() {
        let pool = crate::db::test_pool().await;
        let (gid, bid) = setup(&pool).await;
        // Einsatz-id über das Gebiet ermitteln.
        let eid: i64 = sqlx::query_scalar("SELECT einsatz_id FROM gefahrengebiet WHERE id = ?")
            .bind(gid)
            .fetch_one(&pool)
            .await
            .unwrap();

        let leer = gebiete_liste(&pool, eid).await.unwrap();
        assert_eq!(leer.len(), 1);
        assert_eq!(leer[0].hoechste_warnstufe, Warnstufe::Keine);

        upsert_bewertung(&pool, gid, daten("brand", "menschen", "mittel", bid))
            .await
            .unwrap();
        upsert_bewertung(&pool, gid, daten("explosion", "sachwerte", "akut", bid))
            .await
            .unwrap();
        let voll = gebiete_liste(&pool, eid).await.unwrap();
        assert_eq!(
            voll[0].hoechste_warnstufe,
            Warnstufe::Akut,
            "Severity-Maximum, nicht lexikalisch"
        );
    }

    #[tokio::test]
    async fn aufraeumen_loescht_leeres_gebiet_mit_matrix() {
        let pool = crate::db::test_pool().await;
        let (gid, bid) = setup(&pool).await;
        let eid: i64 = sqlx::query_scalar("SELECT einsatz_id FROM gefahrengebiet WHERE id = ?")
            .bind(gid)
            .fetch_one(&pool)
            .await
            .unwrap();
        upsert_bewertung(&pool, gid, daten("brand", "menschen", "hoch", bid))
            .await
            .unwrap();
        // Keine Zone zeigt auf das Gebiet → aufräumen entfernt es (und die Matrix).
        gebiet_aufraeumen_wenn_leer(&pool, gid).await.unwrap();
        assert!(gebiete_liste(&pool, eid).await.unwrap().is_empty());
        assert!(liste(&pool, gid).await.unwrap().is_empty());
    }
}
