use super::{ChatKanalAnzeige, ChatNachrichtAnzeige, DEFAULT_KANAL_NAME};
use crate::error::AppError;
use sqlx::{QueryBuilder, Sqlite, SqlitePool};

/// Lädt alle Kanäle eines Einsatzes und stellt sicher, dass mindestens der
/// Default-Kanal existiert (lazy-Anlage mit `default_ersteller_id` als Ersteller).
/// Das deckt Bestands-Einsätze ohne Backfill ab. Das `INSERT … WHERE NOT EXISTS`
/// verhindert ein Duplikat, falls bereits ein Kanal existiert.
pub async fn liste_kanaele(
    pool: &SqlitePool,
    einsatz_id: i64,
    default_ersteller_id: i64,
) -> Result<Vec<ChatKanalAnzeige>, AppError> {
    sqlx::query(
        "INSERT INTO chat_kanal (einsatz_id, name, erstellt_von_id) \
         SELECT ?, ?, ? \
         WHERE NOT EXISTS (SELECT 1 FROM chat_kanal WHERE einsatz_id = ?)",
    )
    .bind(einsatz_id)
    .bind(DEFAULT_KANAL_NAME)
    .bind(default_ersteller_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, ChatKanalAnzeige>(
        "SELECT id, einsatz_id, name, beschreibung, erstellt_von_id, erstellt_at, archiviert_at \
         FROM chat_kanal WHERE einsatz_id = ? ORDER BY erstellt_at, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt einen neuen Kanal an und liefert ihn als Anzeige.
pub async fn kanal_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    name: &str,
    beschreibung: Option<&str>,
) -> Result<ChatKanalAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO chat_kanal (einsatz_id, name, beschreibung, erstellt_von_id) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(name)
    .bind(beschreibung)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;

    sqlx::query_as::<_, ChatKanalAnzeige>(
        "SELECT id, einsatz_id, name, beschreibung, erstellt_von_id, erstellt_at, archiviert_at \
         FROM chat_kanal WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

/// Prüft, ob ein Kanal zum angegebenen Einsatz gehört (Schutz gegen Cross-Einsatz-Zugriff).
pub async fn gehoert_kanal_zu_einsatz(
    pool: &SqlitePool,
    kanal_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM chat_kanal WHERE id = ? AND einsatz_id = ?")
            .bind(kanal_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Standard-Seitengröße der Nachrichten-Abfrage.
pub const STANDARD_LIMIT: i64 = 100;
/// Maximale Seitengröße.
pub const MAX_LIMIT: i64 = 500;

/// Eingabedaten für eine neue Nachricht (bereits validiert/getrimmt vom Handler).
#[derive(Debug)]
pub struct NachrichtDaten<'a> {
    pub kanal_id: i64,
    pub inhalt: &'a str,
}

/// Filter-/Cursor-Parameter der Nachrichten-Abfrage.
#[derive(Debug)]
pub struct NachrichtFilter {
    pub kanal_id: i64,
    /// Cursor: nur Nachrichten mit `id <` diesem Wert (ältere Seite).
    pub before_id: Option<i64>,
    pub limit: i64,
}

/// SELECT-Projektion einer Nachricht inkl. Autor-Name. `inhalt` wird bei
/// gelöschten Nachrichten als NULL ausgeliefert (Tombstone).
const NACHRICHT_SELECT: &str =
    "SELECT n.id, n.einsatz_id, n.kanal_id, n.autor_id, b.anzeigename AS autor_name, \
            CASE WHEN n.geloescht_at IS NULL THEN n.inhalt ELSE NULL END AS inhalt, \
            n.erstellt_at, n.bearbeitet_at, n.geloescht_at, n.etb_eintrag_id \
     FROM chat_nachricht n JOIN benutzer b ON b.id = n.autor_id";

/// Lädt eine einzelne Nachricht als Anzeige. `NotFound`, wenn sie nicht existiert.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<ChatNachrichtAnzeige, AppError> {
    sqlx::query_as::<_, ChatNachrichtAnzeige>(&format!("{NACHRICHT_SELECT} WHERE n.id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Legt eine Nachricht an und liefert sie als Anzeige.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    autor_id: i64,
    daten: NachrichtDaten<'_>,
) -> Result<ChatNachrichtAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO chat_nachricht (einsatz_id, kanal_id, autor_id, inhalt) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.kanal_id)
    .bind(autor_id)
    .bind(daten.inhalt)
    .fetch_one(pool)
    .await?;
    laden(pool, id).await
}

/// Fragt Nachrichten eines Kanals ab. Sortierung: `id DESC` (neueste zuerst),
/// Cursor über `before_id`.
pub async fn abfrage(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &NachrichtFilter,
) -> Result<Vec<ChatNachrichtAnzeige>, AppError> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(NACHRICHT_SELECT);
    qb.push(" WHERE n.einsatz_id = ");
    qb.push_bind(einsatz_id);
    qb.push(" AND n.kanal_id = ");
    qb.push_bind(filter.kanal_id);
    if let Some(cursor) = filter.before_id {
        qb.push(" AND n.id < ");
        qb.push_bind(cursor);
    }
    qb.push(" ORDER BY n.id DESC LIMIT ");
    qb.push_bind(filter.limit);

    qb.build_query_as::<ChatNachrichtAnzeige>()
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Prüft, ob eine Nachricht zum angegebenen Einsatz gehört (Cross-Einsatz-Schutz).
pub async fn gehoert_nachricht_zu_einsatz(
    pool: &SqlitePool,
    nachricht_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM chat_nachricht WHERE id = ? AND einsatz_id = ?")
            .bind(nachricht_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Liefert die Autor-ID einer Nachricht (`None`, wenn sie nicht existiert).
/// Grundlage für die Autor-Prüfung bei Bearbeiten/Löschen.
pub async fn autor_von(pool: &SqlitePool, nachricht_id: i64) -> Result<Option<i64>, AppError> {
    sqlx::query_scalar("SELECT autor_id FROM chat_nachricht WHERE id = ?")
        .bind(nachricht_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

/// Bearbeitet den Inhalt einer Nachricht und setzt `bearbeitet_at` auf jetzt.
pub async fn bearbeiten(
    pool: &SqlitePool,
    nachricht_id: i64,
    neuer_inhalt: &str,
) -> Result<ChatNachrichtAnzeige, AppError> {
    sqlx::query(
        "UPDATE chat_nachricht SET inhalt = ?, bearbeitet_at = datetime('now') \
         WHERE id = ? AND geloescht_at IS NULL",
    )
    .bind(neuer_inhalt)
    .bind(nachricht_id)
    .execute(pool)
    .await?;
    laden(pool, nachricht_id).await
}

/// Soft-löscht eine Nachricht (Tombstone via `geloescht_at`).
pub async fn loeschen(pool: &SqlitePool, nachricht_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE chat_nachricht SET geloescht_at = datetime('now') WHERE id = ?")
        .bind(nachricht_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn kanal(pool: &SqlitePool, einsatz: i64, benutzer: i64) -> i64 {
        kanal_anlegen(pool, einsatz, benutzer, "K", None).await.unwrap().id
    }

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an; liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id)
    }

    #[tokio::test]
    async fn liste_kanaele_legt_default_an() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let kanaele = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(kanaele.len(), 1);
        assert_eq!(kanaele[0].name, DEFAULT_KANAL_NAME);

        // Idempotent: ein zweiter Aufruf legt keinen weiteren Default an.
        let nochmal = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(nochmal.len(), 1);
    }

    #[tokio::test]
    async fn kanal_anlegen_erscheint_in_liste() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        liste_kanaele(&pool, einsatz, benutzer).await.unwrap(); // Default sicherstellen

        let kanal = kanal_anlegen(&pool, einsatz, benutzer, "S2/S3", Some("Lagebild")).await.unwrap();
        assert_eq!(kanal.name, "S2/S3");
        assert_eq!(kanal.beschreibung.as_deref(), Some("Lagebild"));

        let kanaele = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(kanaele.len(), 2);
    }

    #[tokio::test]
    async fn gehoert_kanal_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kanal = kanal_anlegen(&pool, einsatz, benutzer, "K", None).await.unwrap();

        assert!(gehoert_kanal_zu_einsatz(&pool, kanal.id, einsatz).await.unwrap());
        assert!(!gehoert_kanal_zu_einsatz(&pool, kanal.id, 999).await.unwrap());
        assert!(!gehoert_kanal_zu_einsatz(&pool, 12345, einsatz).await.unwrap());
    }

    #[tokio::test]
    async fn anlegen_und_abfrage_neueste_zuerst() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;

        let m1 = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "Hallo" }).await.unwrap();
        anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "Welt" }).await.unwrap();

        assert_eq!(m1.inhalt.as_deref(), Some("Hallo"));
        assert_eq!(m1.autor_name, "Leitung");

        let liste = abfrage(&pool, einsatz, &NachrichtFilter { kanal_id: kid, before_id: None, limit: STANDARD_LIMIT }).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].inhalt.as_deref(), Some("Welt"), "neueste zuerst");
    }

    #[tokio::test]
    async fn abfrage_cursor_blaettert_zu_aelteren() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        for i in 1..=3 {
            anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: &format!("m{i}") }).await.unwrap();
        }

        let f = NachrichtFilter { kanal_id: kid, before_id: None, limit: 1 };
        let seite1 = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(seite1[0].inhalt.as_deref(), Some("m3"));

        let f2 = NachrichtFilter { kanal_id: kid, before_id: Some(seite1[0].id), limit: 1 };
        let seite2 = abfrage(&pool, einsatz, &f2).await.unwrap();
        assert_eq!(seite2[0].inhalt.as_deref(), Some("m2"));
    }

    #[tokio::test]
    async fn abfrage_nur_des_kanals() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let k1 = kanal(&pool, einsatz, benutzer).await;
        let k2 = kanal(&pool, einsatz, benutzer).await;
        anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: k1, inhalt: "in k1" }).await.unwrap();
        anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: k2, inhalt: "in k2" }).await.unwrap();

        let liste = abfrage(&pool, einsatz, &NachrichtFilter { kanal_id: k1, before_id: None, limit: STANDARD_LIMIT }).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].inhalt.as_deref(), Some("in k1"));
    }

    #[tokio::test]
    async fn gehoert_nachricht_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();

        assert!(gehoert_nachricht_zu_einsatz(&pool, m.id, einsatz).await.unwrap());
        assert!(!gehoert_nachricht_zu_einsatz(&pool, m.id, 999).await.unwrap());
    }

    #[tokio::test]
    async fn autor_von_liefert_autor_id() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();

        assert_eq!(autor_von(&pool, m.id).await.unwrap(), Some(benutzer));
        assert_eq!(autor_von(&pool, 999).await.unwrap(), None);
    }

    #[tokio::test]
    async fn bearbeiten_setzt_inhalt_und_bearbeitet_at() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "alt" }).await.unwrap();
        assert_eq!(m.bearbeitet_at, None);

        let bearbeitet = bearbeiten(&pool, m.id, "neu").await.unwrap();
        assert_eq!(bearbeitet.inhalt.as_deref(), Some("neu"));
        assert!(bearbeitet.bearbeitet_at.is_some());
    }

    #[tokio::test]
    async fn loeschen_setzt_tombstone() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "geheim" }).await.unwrap();

        loeschen(&pool, m.id).await.unwrap();
        let nachher = laden(&pool, m.id).await.unwrap();
        assert!(nachher.geloescht_at.is_some());
        assert_eq!(nachher.inhalt, None, "Inhalt gelöschter Nachrichten wird nicht ausgeliefert");
    }
}
