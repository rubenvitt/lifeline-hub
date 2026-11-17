//! Änderungsvermerk je Einzelangabe (LLH-1834, Change `nvhnqynd-konflikt-und-aenderungsvermerk`,
//! design.md D3/D4, Spec `aenderungsvermerk`): wer eine Angabe von Einsatzkopf, Einheit oder
//! eigener Führungsstelle zuletzt geändert hat und wann.
//!
//! Gesetzt wird auf der Schreibtransaktion der Angabe, nur für Felder, deren gespeicherter Wert
//! sich geändert hat (der Aufrufer vergleicht Vorher und Nachher). Die Feldnamen sind feste
//! Wire-Namen aus dem Code, nie aus der Anfrage. Kein ETB-Eintrag (Spec, „Kein ETB-Eintrag aus
//! dem Vermerk“).

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use crate::error::AppError;

/// Wessen Angaben ein Vermerk trägt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Objekt {
    Einsatz,
    Einheit(i64),
    Fuehrungsstelle,
}

impl Objekt {
    fn art(self) -> &'static str {
        match self {
            Objekt::Einsatz => "einsatz",
            Objekt::Einheit(_) => "einheit",
            Objekt::Fuehrungsstelle => "fuehrungsstelle",
        }
    }

    fn einheit_id(self) -> Option<i64> {
        match self {
            Objekt::Einheit(id) => Some(id),
            _ => None,
        }
    }
}

/// Der Vermerk einer Angabe: Zeitpunkt (SQLite-Format, UTC) und Anzeigename des Benutzers
/// (`None`, wenn der Benutzer fehlt).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct FeldVermerk {
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub von: Option<String>,
}

/// Vermerke eines Objekts, je Wire-Feldname.
pub type Vermerke = BTreeMap<String, FeldVermerk>;

/// Setzt den Vermerk für jedes genannte Feld auf „jetzt, durch `von`“, auf der offenen
/// Transaktion des Schreibwegs. „UPDATE, sonst INSERT“, weil der eindeutige Index über einen
/// Ausdruck läuft (`IFNULL(einheit_id, 0)`).
pub async fn setze_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    objekt: Objekt,
    felder: &[&'static str],
    von: i64,
) -> Result<(), AppError> {
    for feld in felder {
        let getroffen = sqlx::query(
            "UPDATE einsatz_feld_vermerk \
             SET geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ?1 \
             WHERE einsatz_id = ?2 AND objekt_art = ?3 AND IFNULL(einheit_id, 0) = ?4 \
               AND feld = ?5",
        )
        .bind(von)
        .bind(einsatz_id)
        .bind(objekt.art())
        .bind(objekt.einheit_id().unwrap_or(0))
        .bind(*feld)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        if getroffen == 0 {
            sqlx::query(
                "INSERT INTO einsatz_feld_vermerk \
                   (einsatz_id, objekt_art, einheit_id, feld, geaendert_at, geaendert_von) \
                 VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%d %H:%M:%S','now'), ?5)",
            )
            .bind(einsatz_id)
            .bind(objekt.art())
            .bind(objekt.einheit_id())
            .bind(*feld)
            .bind(von)
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(())
}

type Zeile = (Option<i64>, String, String, Option<String>);

const SELECT: &str = "SELECT v.einheit_id, v.feld, v.geaendert_at, b.anzeigename \
     FROM einsatz_feld_vermerk v LEFT JOIN benutzer b ON b.id = v.geaendert_von \
     WHERE v.einsatz_id = ?1 AND v.objekt_art = ?2";

fn eintrag((_, feld, at, von): Zeile) -> (String, FeldVermerk) {
    (feld, FeldVermerk { at, von })
}

/// Die Vermerke eines Objekts.
pub async fn load(
    pool: &SqlitePool,
    einsatz_id: i64,
    objekt: Objekt,
) -> Result<Vermerke, AppError> {
    let zeilen: Vec<Zeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} AND IFNULL(v.einheit_id, 0) = ?3"
    )))
    .bind(einsatz_id)
    .bind(objekt.art())
    .bind(objekt.einheit_id().unwrap_or(0))
    .fetch_all(pool)
    .await?;
    Ok(zeilen.into_iter().map(eintrag).collect())
}

/// Die Vermerke aller Einheiten eines Einsatzes in einer Abfrage, je Einheit (kein N+1 für
/// Listen).
pub async fn load_einheiten(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<HashMap<i64, Vermerke>, AppError> {
    let zeilen: Vec<Zeile> = sqlx::query_as(SELECT)
        .bind(einsatz_id)
        .bind("einheit")
        .fetch_all(pool)
        .await?;
    let mut je_einheit: HashMap<i64, Vermerke> = HashMap::new();
    for z in zeilen {
        if let Some(eid) = z.0 {
            let (feld, v) = eintrag(z);
            je_einheit.entry(eid).or_default().insert(feld, v);
        }
    }
    Ok(je_einheit)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Organisation, Benutzer, Einsatz und eine Einheit; liefert `(einsatz, einheit, benutzer)`.
    async fn einsatz_mit_einheit(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
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
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Trupp 1') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz, einheit, benutzer)
    }

    #[tokio::test]
    async fn setzt_einmal_und_aktualisiert_danach() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, eid, von) = einsatz_mit_einheit(&pool).await;
        {
            let mut conn = pool.acquire().await.unwrap();
            for _ in 0..2 {
                setze_tx(
                    &mut conn,
                    einsatz_id,
                    Objekt::Einheit(eid),
                    &["bemerkung"],
                    von,
                )
                .await
                .unwrap();
            }
        }
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_feld_vermerk")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 1, "derselbe Vermerk wird aktualisiert, nicht verdoppelt");
        let v = load(&pool, einsatz_id, Objekt::Einheit(eid)).await.unwrap();
        assert!(v["bemerkung"].von.is_some());
        assert!(load(&pool, einsatz_id, Objekt::Einsatz)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn einsatz_und_fuehrungsstelle_getrennt_von_einheiten() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, eid, von) = einsatz_mit_einheit(&pool).await;
        {
            let mut conn = pool.acquire().await.unwrap();
            for (objekt, feld) in [
                (Objekt::Einsatz, "leitstellen_nr"),
                (Objekt::Fuehrungsstelle, "rufname"),
                (Objekt::Einheit(eid), "name"),
            ] {
                setze_tx(&mut conn, einsatz_id, objekt, &[feld], von)
                    .await
                    .unwrap();
            }
        }
        let kopf = load(&pool, einsatz_id, Objekt::Einsatz).await.unwrap();
        assert_eq!(kopf.keys().collect::<Vec<_>>(), ["leitstellen_nr"]);
        let alle = load_einheiten(&pool, einsatz_id).await.unwrap();
        assert_eq!(alle[&eid].keys().collect::<Vec<_>>(), ["name"]);
    }

    #[tokio::test]
    async fn fehlender_benutzer_ergibt_von_none() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, _, _) = einsatz_mit_einheit(&pool).await;
        sqlx::query(
            "INSERT INTO einsatz_feld_vermerk (einsatz_id, objekt_art, feld, geaendert_at) \
             VALUES (?, 'einsatz', 'bezeichnung', '2026-11-17 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await
        .unwrap();
        let v = load(&pool, einsatz_id, Objekt::Einsatz).await.unwrap();
        assert_eq!(v["bezeichnung"].von, None);
    }

    #[tokio::test]
    async fn einheit_braucht_einheit_id() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, _, _) = einsatz_mit_einheit(&pool).await;
        let r = sqlx::query(
            "INSERT INTO einsatz_feld_vermerk (einsatz_id, objekt_art, feld, geaendert_at) \
             VALUES (?, 'einheit', 'name', '2026-11-17 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await;
        assert!(r.is_err(), "CHECK: 'einheit' ohne einheit_id");
    }
}
