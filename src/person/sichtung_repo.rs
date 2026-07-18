use crate::error::AppError;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Ein Sichtungs-Verlaufseintrag (1:1 zu `person_sichtung`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct SichtungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    #[schema(value_type = crate::person::Sichtungskategorie)]
    pub kategorie: String,
    pub notiz: Option<String>,
    pub gesichtet_at: String,
    pub gesichtet_von: i64,
}

const SELECT_SICHTUNG: &str = "\
    SELECT id, einsatz_id, person_id, kategorie, notiz, gesichtet_at, gesichtet_von \
    FROM person_sichtung";

/// Erfasst eine Sichtung append-only und aktualisiert den Cache — beides sowie der
/// optionale `erfasst→betroffen`-Hub laufen auf der übergebenen offenen
/// Connection/Transaktion (F06/LFH-244, Tier-A: der Aufrufer bündelt das mit dem
/// System-ETB-Eintrag in EINE `write_retry!`-Tx). `kategorie` muss bereits validiert
/// sein (Handler). Bei `hebe_auf_betroffen` wird die Person vorab `erfasst→betroffen`
/// gehoben (Annahme 5). Liefert die frische Anzeige via In-Tx-Reload.
pub async fn erfassen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    kategorie: &str,
    notiz: Option<&str>,
    gesichtet_von: i64,
    hebe_auf_betroffen: bool,
) -> Result<SichtungAnzeige, AppError> {
    if hebe_auf_betroffen {
        sqlx::query(
            "UPDATE einsatz_person SET status = 'betroffen', \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(gesichtet_von)
        .bind(person_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    }
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_sichtung (einsatz_id, person_id, kategorie, notiz, gesichtet_von) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(kategorie)
    .bind(notiz)
    .bind(gesichtet_von)
    .fetch_one(&mut *conn)
    .await?;
    // Cache spiegelt die jüngste Sichtung; das At-Feld übernimmt exakt deren gesichtet_at.
    sqlx::query(
        "UPDATE einsatz_person SET aktuelle_sichtung = ?, \
            aktuelle_sichtung_at = (SELECT gesichtet_at FROM person_sichtung WHERE id = ?) \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(kategorie)
    .bind(id)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    laden_tx(conn, einsatz_id, id).await
}

/// Pool-Wrapper: erfasst eine Sichtung in EINER eigenen Transaktion (bündelt den
/// optionalen Status-Hub, den INSERT und die Cache-Aktualisierung atomar) und lädt die
/// Anzeige. Delegiert an [`erfassen_tx`].
pub async fn erfassen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    kategorie: &str,
    notiz: Option<&str>,
    gesichtet_von: i64,
    hebe_auf_betroffen: bool,
) -> Result<SichtungAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    let anzeige = erfassen_tx(
        &mut tx,
        einsatz_id,
        person_id,
        kategorie,
        notiz,
        gesichtet_von,
        hebe_auf_betroffen,
    )
    .await?;
    tx.commit().await?;
    Ok(anzeige)
}

/// Lädt eine Sichtung; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<SichtungAnzeige, AppError> {
    sqlx::query_as::<_, SichtungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_SICHTUNG} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Wie [`laden`], aber auf einer offenen Connection/Transaktion (In-Tx-Reload für den
/// atomaren Erfassungs-Pfad).
pub async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<SichtungAnzeige, AppError> {
    sqlx::query_as::<_, SichtungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_SICHTUNG} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Sichtungs-Verlauf einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<SichtungAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, SichtungAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_SICHTUNG} WHERE einsatz_id = ? AND person_id = ? \
         ORDER BY gesichtet_at DESC, id DESC"
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Org + Benutzer + aktiver Einsatz + eine Person (Status erfasst). Liefert (benutzer_id, einsatz_id, person_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e, p)
    }

    async fn status(pool: &SqlitePool, person_id: i64) -> String {
        sqlx::query_scalar("SELECT status FROM einsatz_person WHERE id = ?")
            .bind(person_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn erfassen_ist_append_only_und_cache_spiegelt_juengste() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        erfassen(&pool, e, p, "sk2", None, b, false).await.unwrap();
        erfassen(&pool, e, p, "sk1", Some("verschlechtert"), b, false)
            .await
            .unwrap();
        let verlauf = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(verlauf.len(), 2, "beide Sichtungen bleiben (append-only)");
        assert_eq!(verlauf[0].kategorie, "sk1", "neueste zuerst");
        // Cache spiegelt jüngste Sichtung + deren Zeitstempel:
        let (kat, at): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT aktuelle_sichtung, aktuelle_sichtung_at FROM einsatz_person WHERE id = ?",
        )
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(kat.as_deref(), Some("sk1"));
        assert_eq!(
            at.as_deref(),
            Some(verlauf[0].gesichtet_at.as_str()),
            "Cache-At = jüngstes gesichtet_at"
        );
    }

    #[tokio::test]
    async fn hebe_auf_betroffen_setzt_status_in_derselben_aktion() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        assert_eq!(status(&pool, p).await, "erfasst");
        erfassen(&pool, e, p, "sk3", None, b, true).await.unwrap();
        assert_eq!(
            status(&pool, p).await,
            "betroffen",
            "erfasst→betroffen durch Sichtung"
        );
    }

    #[tokio::test]
    async fn sichtung_tot_aendert_admin_status_nicht() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        // Vorbedingung: Person ist betroffen (kein erfasst-Anheben mehr nötig).
        sqlx::query("UPDATE einsatz_person SET status='betroffen' WHERE id=?")
            .bind(p)
            .execute(&pool)
            .await
            .unwrap();
        erfassen(&pool, e, p, "tot", None, b, false).await.unwrap();
        assert_eq!(
            status(&pool, p).await,
            "betroffen",
            "Sichtung=tot lässt Admin-Status unangetastet"
        );
    }
}
