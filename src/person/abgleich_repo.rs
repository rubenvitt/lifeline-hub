use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Ein Vermisstenabgleich (1:1 zu `person_abgleich`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AbgleichAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub vermisst_person_id: i64,
    pub gefunden_person_id: i64,
    pub status: String,
    pub erstellt_at: String,
    pub erstellt_von: i64,
    pub entschieden_at: Option<String>,
    pub entschieden_von: Option<i64>,
}

const SELECT_ABGLEICH: &str = "\
    SELECT id, einsatz_id, vermisst_person_id, gefunden_person_id, status, \
           erstellt_at, erstellt_von, entschieden_at, entschieden_von \
    FROM person_abgleich";

/// Legt einen Verdachts-Link an (Status `verdacht`). Die fachliche Validierung
/// (Status der beteiligten Personen, gleicher Einsatz, nicht dieselbe Person)
/// ist Handler-Aufgabe (Task 12).
pub async fn anlegen_verdacht(
    pool: &SqlitePool,
    einsatz_id: i64,
    vermisst_person_id: i64,
    gefunden_person_id: i64,
    erstellt_von: i64,
) -> Result<AbgleichAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_abgleich \
            (einsatz_id, vermisst_person_id, gefunden_person_id, erstellt_von) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(vermisst_person_id)
    .bind(gefunden_person_id)
    .bind(erstellt_von)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

/// Lädt einen Abgleich; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<AbgleichAnzeige, AppError> {
    sqlx::query_as::<_, AbgleichAnzeige>(&format!("{SELECT_ABGLEICH} WHERE id = ? AND einsatz_id = ?"))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Entscheidet einen Abgleich (`bestaetigt`/`verworfen`). Bei `bestaetigt` wird in
/// DERSELBEN Transaktion die Vermisstmeldung `→ abgemeldet` gesetzt; der partielle
/// Unique-Index erzwingt höchstens einen bestätigten Abgleich je Vermisstmeldung
/// (Verletzung → `Conflict`). Voraussetzung (Handler): Abgleich-Status == `verdacht`.
pub async fn entscheide(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    entscheidung: &str,
    entschieden_von: i64,
) -> Result<AbgleichAnzeige, AppError> {
    let abgleich = laden(pool, einsatz_id, id).await?;
    let mut tx = pool.begin().await?;
    let ergebnis = sqlx::query(
        "UPDATE person_abgleich SET status = ?, \
            entschieden_at = strftime('%Y-%m-%d %H:%M:%S','now'), entschieden_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(entscheidung)
    .bind(entschieden_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await;
    if let Err(e) = ergebnis {
        // Partieller Unique-Index: bereits ein bestätigter Abgleich je Vermisstmeldung.
        if let sqlx::Error::Database(db) = &e {
            if db.is_unique_violation() {
                return Err(AppError::Conflict(
                    "Für diese Vermisstmeldung ist bereits ein Abgleich bestätigt".into(),
                ));
            }
        }
        return Err(e.into());
    }
    if entscheidung == "bestaetigt" {
        sqlx::query(
            "UPDATE einsatz_person SET status = 'abgemeldet', \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(entschieden_von)
        .bind(abgleich.vermisst_person_id)
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Abgleiche, an denen die Person beteiligt ist (als vermisst ODER gefunden),
/// neueste zuerst.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<AbgleichAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, AbgleichAnzeige>(&format!(
        "{SELECT_ABGLEICH} WHERE einsatz_id = ? \
         AND (vermisst_person_id = ? OR gefunden_person_id = ?) \
         ORDER BY erstellt_at DESC, id DESC"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .bind(person_id)
    .fetch_all(pool)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Liefert (benutzer, einsatz, vermisst_id, gefunden_a, gefunden_b).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let mk = |nr: i64, status: &'static str| {
            let e = e; let b = b; let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
                     VALUES (?, ?, ?, ?, ?) RETURNING id")
                    .bind(e).bind(nr).bind(status).bind(b).bind(b)
                    .fetch_one(&pool).await.unwrap()
            }
        };
        let vermisst = mk(1, "vermisst").await;
        let gef_a = mk(2, "betroffen").await;
        let gef_b = mk(3, "betroffen").await;
        (b, e, vermisst, gef_a, gef_b)
    }

    async fn status(pool: &SqlitePool, person_id: i64) -> String {
        sqlx::query_scalar("SELECT status FROM einsatz_person WHERE id = ?")
            .bind(person_id).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn verdacht_anlegen_und_liste_je_person() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        assert_eq!(a.status, "verdacht");
        // Taucht sowohl beim Vermissten als auch bei der gefundenen Person auf:
        assert_eq!(liste_je_person(&pool, e, v).await.unwrap().len(), 1);
        assert_eq!(liste_je_person(&pool, e, g).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn bestaetigen_meldet_vermissten_ab() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        let entschieden = entscheide(&pool, e, a.id, "bestaetigt", b).await.unwrap();
        assert_eq!(entschieden.status, "bestaetigt");
        assert!(entschieden.entschieden_at.is_some());
        assert_eq!(status(&pool, v).await, "abgemeldet", "Vermisstmeldung aufgeklärt → abgemeldet");
    }

    #[tokio::test]
    async fn zweiter_bestaetigter_je_vermisstmeldung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e, v, g_a, g_b) = setup(&pool).await;
        let a1 = anlegen_verdacht(&pool, e, v, g_a, b).await.unwrap();
        let a2 = anlegen_verdacht(&pool, e, v, g_b, b).await.unwrap();
        entscheide(&pool, e, a1.id, "bestaetigt", b).await.unwrap();
        let err = entscheide(&pool, e, a2.id, "bestaetigt", b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "Unique-Index: nur ein bestätigter Abgleich je Vermisstmeldung");
    }

    #[tokio::test]
    async fn verwerfen_laesst_status_unveraendert() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        entscheide(&pool, e, a.id, "verworfen", b).await.unwrap();
        assert_eq!(status(&pool, v).await, "vermisst", "verworfen ändert den Status nicht");
    }

    #[tokio::test]
    async fn liste_je_person_filtert_korrekt_auch_bei_id_kollision() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        // Eine vierte Person, die NICHT am Abgleich beteiligt ist.
        let unbeteiligt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 99, 'erfasst', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        // Unbeteiligte Person hat KEINEN Abgleich — Query muss leere Liste liefern.
        assert_eq!(
            liste_je_person(&pool, e, unbeteiligt).await.unwrap().len(),
            0,
            "person_id-Filter muss greifen (unbeteiligte Person hat keinen Abgleich)"
        );
    }
}
