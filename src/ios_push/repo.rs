//! Speicher von iOS-Push (`migrations/0363_ios_push.sql`).

use super::krypto::{b64_lesen, nachweis};
use super::SPERRE_GILT_STUNDEN;
use crate::benachrichtigung::BenachrichtigungArt;
use crate::error::AppError;
use crate::web_push::repo::{stumm_bereinigt, Wahl};
use sqlx::types::Json;
use sqlx::{SqliteConnection, SqlitePool};

/// Eine Anmeldung, wie der Versand sie braucht.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Anmeldung {
    pub id: i64,
    pub kennung: String,
    pub benutzer_id: i64,
    pub token: String,
    pub umgebung: String,
    /// Base64url des 32-Byte-Schlüssels, mit dem die Nutzlast an dieses Gerät verschlüsselt wird.
    pub schluessel: String,
    pub inhalt: bool,
    pub stumm: Json<Vec<String>>,
}

impl Anmeldung {
    /// Ob `art` auf dem Gerät stumm ist; über einen Alarm entscheidet der Versand.
    pub fn ist_stumm(&self, art: BenachrichtigungArt) -> bool {
        self.stumm.iter().any(|a| a == art.as_str())
    }
}

/// Was ein Gerät bei der Anmeldung meldet.
pub struct Eingabe<'a> {
    pub kennung: &'a str,
    pub token: &'a str,
    pub umgebung: &'a str,
    pub schluessel: &'a str,
    pub wahl: &'a Wahl,
}

/// Meldet ein Gerät für die Sitzung `token_hash` an. Ein bekanntes Token (dasselbe Gerät, neuer
/// Nutzer oder neue Kennung) und eine bekannte Kennung mit anderem Token ersetzen die alte
/// Anmeldung; es bleibt eine Zeile.
pub async fn anmelden(
    pool: &SqlitePool,
    benutzer_id: i64,
    token_hash: &str,
    e: &Eingabe<'_>,
) -> Result<(), AppError> {
    let stumm: Vec<&str> = stumm_bereinigt(&e.wahl.stumm)
        .iter()
        .map(BenachrichtigungArt::as_str)
        .collect();
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM ios_push_anmeldung WHERE kennung = ? AND token <> ?")
        .bind(e.kennung)
        .bind(e.token)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO ios_push_anmeldung \
             (kennung, benutzer_id, session_token_hash, token, umgebung, schluessel, inhalt, stumm) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(token) DO UPDATE SET kennung = excluded.kennung, \
             benutzer_id = excluded.benutzer_id, session_token_hash = excluded.session_token_hash, \
             umgebung = excluded.umgebung, schluessel = excluded.schluessel, \
             inhalt = excluded.inhalt, stumm = excluded.stumm",
    )
    .bind(e.kennung)
    .bind(benutzer_id)
    .bind(token_hash)
    .bind(e.token)
    .bind(e.umgebung)
    .bind(e.schluessel)
    .bind(e.wahl.inhalt)
    .bind(Json(stumm))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Meldet die eigene Anmeldung ab (idempotent).
pub async fn abmelden(pool: &SqlitePool, benutzer_id: i64, kennung: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM ios_push_anmeldung WHERE benutzer_id = ? AND kennung = ?")
        .bind(benutzer_id)
        .bind(kennung)
        .execute(pool)
        .await?;
    Ok(())
}

/// Meldet ohne Sitzung ab, gegen den Nachweis des Geräts ([`nachweis`]). Eine unbekannte
/// Kennung ist ein Erfolg (idempotent, verrät nichts); ein falscher Nachweis ist `Forbidden` und
/// ändert nichts. Der Vergleich läuft in konstanter Zeit.
pub async fn abmelden_mit_nachweis(
    pool: &SqlitePool,
    kennung: &str,
    nachweis_text: &str,
) -> Result<(), AppError> {
    let schluessel: Option<String> =
        sqlx::query_scalar("SELECT schluessel FROM ios_push_anmeldung WHERE kennung = ?")
            .bind(kennung)
            .fetch_optional(pool)
            .await?;
    let Some(schluessel) = schluessel else {
        return Ok(());
    };
    let Some(schluessel) = b64_lesen(&schluessel).and_then(|b| <[u8; 32]>::try_from(b).ok()) else {
        return Err(AppError::Forbidden);
    };
    let erwartet = nachweis(&schluessel, kennung);
    if erwartet.len() != nachweis_text.len()
        || !openssl::memcmp::eq(erwartet.as_bytes(), nachweis_text.as_bytes())
    {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM ios_push_anmeldung WHERE kennung = ?")
        .bind(kennung)
        .execute(pool)
        .await?;
    Ok(())
}

/// Die Anmeldung dieses Nutzers mit dieser Kennung.
pub async fn anmeldung(
    pool: &SqlitePool,
    benutzer_id: i64,
    kennung: &str,
) -> Result<Option<Anmeldung>, AppError> {
    Ok(sqlx::query_as::<_, Anmeldung>(
        "SELECT id, kennung, benutzer_id, token, umgebung, schluessel, inhalt, stumm \
         FROM ios_push_anmeldung WHERE benutzer_id = ? AND kennung = ?",
    )
    .bind(benutzer_id)
    .bind(kennung)
    .fetch_optional(pool)
    .await?)
}

/// Alle Anmeldungen dieser Nutzer, in einer Abfrage.
pub async fn anmeldungen_von(
    pool: &SqlitePool,
    benutzer_ids: &[i64],
) -> Result<Vec<Anmeldung>, AppError> {
    if benutzer_ids.is_empty() {
        return Ok(Vec::new());
    }
    let liste = serde_json::to_string(benutzer_ids).expect("Zahlenliste serialisierbar");
    Ok(sqlx::query_as::<_, Anmeldung>(
        "SELECT id, kennung, benutzer_id, token, umgebung, schluessel, inhalt, stumm \
         FROM ios_push_anmeldung \
         WHERE benutzer_id IN (SELECT value FROM json_each(?)) ORDER BY id",
    )
    .bind(liste)
    .fetch_all(pool)
    .await?)
}

/// Löscht die Anmeldungen, die an diesen Sitzungen hängen (Abmelden eines Geräts per
/// „Sitzungen beenden“). Ein bloßer Sitzungsablauf löscht nichts: dort setzt die DB
/// `session_token_hash` auf NULL.
pub async fn loeschen_fuer_sitzungen(
    conn: &mut SqliteConnection,
    token_hashes: &[String],
) -> Result<(), AppError> {
    if token_hashes.is_empty() {
        return Ok(());
    }
    let liste = serde_json::to_string(token_hashes).expect("Textliste serialisierbar");
    sqlx::query(
        "DELETE FROM ios_push_anmeldung \
         WHERE session_token_hash IN (SELECT value FROM json_each(?))",
    )
    .bind(liste)
    .execute(conn)
    .await?;
    Ok(())
}

/// Löscht alle Anmeldungen eines Nutzers.
pub async fn loeschen_fuer_benutzer(
    conn: &mut SqliteConnection,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM ios_push_anmeldung WHERE benutzer_id = ?")
        .bind(benutzer_id)
        .execute(conn)
        .await?;
    Ok(())
}

/// Löscht alle Anmeldungen eines Nutzers außer denen an der Sitzung `behaltener_hash` („alle
/// anderen Sitzungen beenden“: das eigene Gerät pusht weiter). Auch Anmeldungen ohne Sitzung
/// (abgelaufen, `session_token_hash` NULL) gehen mit: gerade das verlorene Gerät hat oft keine
/// gültige Sitzung mehr. `None` löscht alle des Nutzers.
pub async fn loeschen_fuer_benutzer_ausser(
    conn: &mut SqliteConnection,
    benutzer_id: i64,
    behaltener_hash: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM ios_push_anmeldung \
         WHERE benutzer_id = ? AND (? IS NULL OR session_token_hash IS NOT ?)",
    )
    .bind(benutzer_id)
    .bind(behaltener_hash)
    .bind(behaltener_hash)
    .execute(conn)
    .await?;
    Ok(())
}

/// Löscht eine Anmeldung, die APNs als erloschen meldet, nur bei noch gleichem Token.
pub async fn erloschen(pool: &SqlitePool, id: i64, token: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM ios_push_anmeldung WHERE id = ? AND token = ?")
        .bind(id)
        .bind(token)
        .execute(pool)
        .await?;
    Ok(())
}

/// Der Zugang dieser Instanz zum Relais.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelaisZugang {
    pub server_id: String,
    pub geheimnis: String,
    /// Das Relais hat diesen Server gesperrt (`gesperrt_at` gesetzt).
    pub gesperrt: bool,
    /// Die Sperre ist älter als [`SPERRE_GILT_STUNDEN`]: der nächste Versand versucht es einmal.
    /// Beim Speichern ohne Bedeutung.
    pub sperre_abgelaufen: bool,
}

pub async fn relais_zugang(pool: &SqlitePool) -> Result<Option<RelaisZugang>, AppError> {
    let zeile: Option<(String, String, bool, bool)> = sqlx::query_as(
        "SELECT server_id, geheimnis, gesperrt_at IS NOT NULL, \
                COALESCE(gesperrt_at <= datetime('now', ?), 0) \
         FROM ios_push_relais WHERE id = 1",
    )
    .bind(format!("-{SPERRE_GILT_STUNDEN} hours"))
    .fetch_optional(pool)
    .await?;
    Ok(zeile.map(
        |(server_id, geheimnis, gesperrt, sperre_abgelaufen)| RelaisZugang {
            server_id,
            geheimnis,
            gesperrt,
            sperre_abgelaufen,
        },
    ))
}

/// Seit wann das Relais diese Instanz sperrt (zuletzt bestätigt), als UTC in `zeit::FORMAT`;
/// `None` ohne Sperre. Für die Warnung in der Verwaltung der Instanz.
pub async fn relais_gesperrt_seit(pool: &SqlitePool) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT gesperrt_at FROM ios_push_relais \
         WHERE id = 1 AND gesperrt_at IS NOT NULL",
    )
    .fetch_optional(pool)
    .await?
    .flatten())
}

/// Speichert den Zugang (ersetzt einen vorhandenen und hebt die Sperre auf).
pub async fn relais_zugang_speichern(pool: &SqlitePool, z: &RelaisZugang) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO ios_push_relais (id, server_id, geheimnis, gesperrt_at) \
         VALUES (1, ?, ?, CASE WHEN ? THEN datetime('now') END) \
         ON CONFLICT(id) DO UPDATE SET server_id = excluded.server_id, \
             geheimnis = excluded.geheimnis, gesperrt_at = excluded.gesperrt_at",
    )
    .bind(&z.server_id)
    .bind(&z.geheimnis)
    .bind(z.gesperrt)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn relais_zugang_loeschen(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query("DELETE FROM ios_push_relais WHERE id = 1")
        .execute(pool)
        .await?;
    Ok(())
}

/// Das Relais hat den Zugang gesperrt (`403`): `gesperrt_at` ist jetzt, auch wenn schon eine
/// ältere Sperre stand. Damit gilt sie wieder [`SPERRE_GILT_STUNDEN`].
pub async fn relais_gesperrt_setzen(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE ios_push_relais SET gesperrt_at = datetime('now') \
         WHERE id = 1",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Das Relais nimmt den Zugang `server_id` wieder an: die Sperre fällt.
pub async fn relais_sperre_aufheben(pool: &SqlitePool, server_id: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE ios_push_relais SET gesperrt_at = NULL WHERE id = 1 AND server_id = ?")
        .bind(server_id)
        .execute(pool)
        .await?;
    Ok(())
}
