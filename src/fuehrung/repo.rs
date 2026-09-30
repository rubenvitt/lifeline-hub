//! Mandantenlabels und S7-Schalter je Organisation (`org_fuehrungsfunktion`, LFH-549).
//!
//! Strikt per `org_id` (Org-Isolation). `label = NULL` bedeutet Standardlabel; `aktiv` gibt es
//! nur für `s7` (die Route lehnt es sonst mit 422 ab), fehlende Zeile oder NULL = aus.

use super::{Fuehrungsfunktion, Labelkarte};
use crate::error::AppError;
use sqlx::SqliteConnection;

/// Lädt die wirksame Labelkarte einer Organisation.
pub async fn labelkarte(conn: &mut SqliteConnection, org_id: i64) -> Result<Labelkarte, AppError> {
    let zeilen = sqlx::query_as::<_, (String, Option<String>, Option<i64>)>(
        "SELECT funktion, label, aktiv FROM org_fuehrungsfunktion WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut karte = Labelkarte::standard();
    for (funktion, label, aktiv) in zeilen {
        let Some(f) = Fuehrungsfunktion::parse(&funktion) else {
            continue;
        };
        if let Some(l) = label {
            karte.ueberschrieben.insert(f, l);
        }
        if f == Fuehrungsfunktion::S7 {
            karte.s7_aktiv = aktiv == Some(1);
        }
    }
    Ok(karte)
}

/// Lädt die Labelkarte zu einem Einsatz (Org des Einsatzes).
pub async fn labelkarte_fuer_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Labelkarte, AppError> {
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
    labelkarte(conn, org_id).await
}

/// Setzt Label und (nur bei s7) den Schalter. `label = None` stellt den Standard wieder her,
/// `aktiv = None` lässt den Schalter unverändert.
pub async fn setzen(
    conn: &mut SqliteConnection,
    org_id: i64,
    funktion: Fuehrungsfunktion,
    label: Option<&str>,
    aktiv: Option<bool>,
    erfasser_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO org_fuehrungsfunktion \
            (org_id, funktion, label, aktiv, geaendert_at, geaendert_von) \
         VALUES (?1, ?2, ?3, ?4, datetime('now'), ?5) \
         ON CONFLICT(org_id, funktion) DO UPDATE SET \
             label = excluded.label, \
             aktiv = COALESCE(excluded.aktiv, org_fuehrungsfunktion.aktiv), \
             geaendert_at = excluded.geaendert_at, \
             geaendert_von = excluded.geaendert_von",
    )
    .bind(org_id)
    .bind(funktion.as_str())
    .bind(label)
    .bind(aktiv.map(i64::from))
    .bind(erfasser_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture(pool: &sqlx::SqlitePool) -> i64 {
        for org in [1, 2] {
            sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
                .bind(org)
                .execute(pool)
                .await
                .unwrap();
        }
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'admin', 'admin', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn ohne_zeilen_standard_und_s7_aus() {
        let pool = crate::db::test_pool().await;
        fixture(&pool).await;
        let mut conn = pool.acquire().await.unwrap();
        let k = labelkarte(&mut conn, 1).await.unwrap();
        assert_eq!(k.label(Fuehrungsfunktion::S4), "Versorgung");
        assert!(!k.s7_aktiv);
    }

    #[tokio::test]
    async fn label_setzen_leeren_und_org_isoliert() {
        let pool = crate::db::test_pool().await;
        let bid = fixture(&pool).await;
        let mut conn = pool.acquire().await.unwrap();
        setzen(
            &mut conn,
            1,
            Fuehrungsfunktion::S4,
            Some("Versorgung (Logistik)"),
            None,
            bid,
        )
        .await
        .unwrap();
        assert_eq!(
            labelkarte(&mut conn, 1)
                .await
                .unwrap()
                .label(Fuehrungsfunktion::S4),
            "Versorgung (Logistik)"
        );
        assert_eq!(
            labelkarte(&mut conn, 2)
                .await
                .unwrap()
                .label(Fuehrungsfunktion::S4),
            "Versorgung",
            "fremde Org sieht das Label nicht"
        );
        setzen(&mut conn, 1, Fuehrungsfunktion::S4, None, None, bid)
            .await
            .unwrap();
        assert_eq!(
            labelkarte(&mut conn, 1)
                .await
                .unwrap()
                .label(Fuehrungsfunktion::S4),
            "Versorgung"
        );
    }

    #[tokio::test]
    async fn s7_schalter_bleibt_beim_labelsetzen_stehen() {
        let pool = crate::db::test_pool().await;
        let bid = fixture(&pool).await;
        let mut conn = pool.acquire().await.unwrap();
        setzen(&mut conn, 1, Fuehrungsfunktion::S7, None, Some(true), bid)
            .await
            .unwrap();
        setzen(&mut conn, 1, Fuehrungsfunktion::S7, Some("PSNV"), None, bid)
            .await
            .unwrap();
        let k = labelkarte(&mut conn, 1).await.unwrap();
        assert!(k.s7_aktiv);
        assert_eq!(k.label(Fuehrungsfunktion::S7), "PSNV");
    }
}
