//! Datenzugriff für die Benutzer-Präferenzen (LFH-391 · Etappe D).
//!
//! Alle Funktionen sind strikt an EINE `benutzer_id` gebunden — die stammt in der Route
//! immer aus der Sitzung, nie aus Pfad oder Body. Damit gibt es keinen Weg, das Fach eines
//! anderen Benutzers zu lesen oder zu beschreiben, und keine Org-Prüfung ist nötig: der
//! Benutzer IST der Schutzbereich.
//!
//! Gültigkeit von Schlüssel und Wert prüft die Route (Statuscode-Konvention LFH-267); das
//! Repo nimmt geprüfte Werte an.

use super::BenutzerEinstellungenAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Lädt alle Präferenzen eines Benutzers. Ohne Zeile: leerer Stand (kein Fehler — „noch nie
/// geschrieben" ist der Normalfall beim ersten Login).
pub async fn laden(
    pool: &SqlitePool,
    benutzer_id: i64,
) -> Result<BenutzerEinstellungenAnzeige, AppError> {
    let zeilen = sqlx::query_as::<_, (String, String, String)>(
        "SELECT schluessel, wert, geaendert_at \
         FROM benutzer_einstellungen WHERE benutzer_id = ?",
    )
    .bind(benutzer_id)
    .fetch_all(pool)
    .await?;

    let mut stand = BenutzerEinstellungenAnzeige::leer();
    for (schluessel, wert, geaendert_at) in zeilen {
        // Jüngster Zeitstempel über alle Schlüssel. Das Format ist SQLites
        // `datetime('now')` (`YYYY-MM-DD HH:MM:SS`, fixe Breite) — lexikographisch
        // vergleichbar, deshalb kein Parsen nötig.
        if stand
            .geaendert_at
            .as_deref()
            .is_none_or(|a| a < &*geaendert_at)
        {
            stand.geaendert_at = Some(geaendert_at);
        }
        stand.eintraege.insert(schluessel, wert);
    }
    Ok(stand)
}

/// UPSERT auf (benutzer_id, schluessel). Eine zweite Zeile für denselben Schlüssel kann
/// dabei nicht entstehen — der Primärschlüssel deckt das Paar.
pub async fn setzen(
    pool: &SqlitePool,
    benutzer_id: i64,
    schluessel: &str,
    wert: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO benutzer_einstellungen (benutzer_id, schluessel, wert, geaendert_at) \
         VALUES (?, ?, ?, datetime('now')) \
         ON CONFLICT(benutzer_id, schluessel) DO UPDATE SET \
             wert = excluded.wert, \
             geaendert_at = excluded.geaendert_at",
    )
    .bind(benutzer_id)
    .bind(schluessel)
    .bind(wert)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Legt Org + Benutzer an; liefert die benutzer_id.
    async fn benutzer(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, ?, ?, 'h') RETURNING id",
        )
        .bind(name)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn laden_ohne_zeile_ist_leerer_stand() {
        let pool = crate::db::test_pool().await;
        let id = benutzer(&pool, "a").await;

        let stand = laden(&pool, id).await.unwrap();
        assert!(stand.eintraege.is_empty());
        assert_eq!(stand.geaendert_at, None);
    }

    #[tokio::test]
    async fn setzen_dann_laden_liefert_wert_und_zeitstempel() {
        let pool = crate::db::test_pool().await;
        let id = benutzer(&pool, "a").await;

        setzen(
            &pool,
            id,
            super::super::SCHLUESSEL_ZULETZT_BEFEHLE,
            "[\"x\"]",
        )
        .await
        .unwrap();

        let stand = laden(&pool, id).await.unwrap();
        assert_eq!(stand.eintraege["zuletzt_befehle"], "[\"x\"]");
        assert!(stand.geaendert_at.is_some());
    }

    #[tokio::test]
    async fn setzen_ersetzt_statt_zu_stapeln() {
        let pool = crate::db::test_pool().await;
        let id = benutzer(&pool, "a").await;

        setzen(&pool, id, "zuletzt_befehle", "[\"a\"]")
            .await
            .unwrap();
        setzen(&pool, id, "zuletzt_befehle", "[\"b\"]")
            .await
            .unwrap();

        let stand = laden(&pool, id).await.unwrap();
        assert_eq!(stand.eintraege["zuletzt_befehle"], "[\"b\"]");
        let zeilen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer_einstellungen")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(zeilen, 1);
    }

    /// Der Kern der Trennung: zwei Benutzer, zwei Fächer. Ohne die `WHERE`-Bindung wäre
    /// dieser Test rot — und zwar mit dem fremden Wert im eigenen Fach.
    #[tokio::test]
    async fn zwei_benutzer_haben_getrennte_faecher() {
        let pool = crate::db::test_pool().await;
        let a = benutzer(&pool, "a").await;
        let b = benutzer(&pool, "b").await;

        setzen(&pool, a, "zuletzt_befehle", "[\"a\"]")
            .await
            .unwrap();

        assert!(laden(&pool, b).await.unwrap().eintraege.is_empty());
        assert_eq!(
            laden(&pool, a).await.unwrap().eintraege["zuletzt_befehle"],
            "[\"a\"]"
        );
    }
}
