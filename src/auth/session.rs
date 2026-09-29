use crate::app::AppState;
use crate::auth::Benutzer;
use crate::error::AppError;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum_extra::extract::cookie::CookieJar;
use sqlx::SqlitePool;
use std::sync::OnceLock;

/// Name des Session-Cookies.
pub const SESSION_COOKIE: &str = "lifeline_sid";

/// Prozessweiter `Secure`-Cookie-Schalter (nur bei aktivem HTTPS `true`, ungesetzt `false`).
/// OnceLock statt AppState-Feld, damit die Inline-Test-Konstruktionen unberührt bleiben.
static COOKIE_SECURE: OnceLock<bool> = OnceLock::new();

/// Einmalig beim Serverstart setzen (true bei HTTPS). Doppelsetzen wird ignoriert.
pub fn set_cookie_secure(v: bool) {
    let _ = COOKIE_SECURE.set(v);
}

/// Ob Session-Cookies `Secure` tragen sollen (Default false → HTTP-Betrieb).
pub fn cookie_secure() -> bool {
    *COOKIE_SECURE.get().unwrap_or(&false)
}

/// Erzeugt einen neuen, kryptografisch zufälligen Session-Token (64 Hex-Zeichen).
pub fn neuer_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// SHA-256-Hex eines Session-Tokens für die At-Rest-Speicherung. In der DB steht nur dieser
/// Hash; ein 256-Bit-Zufallstoken braucht kein Salt/Argon2.
fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Lebensdauer einer Sitzung ab Anmeldung, ohne Verlängerung. Eine Quelle für den Ablauf in
/// der DB und das `Max-Age` des Cookies (LFH-779), damit das Cookie nie länger lebt als die
/// Sitzung dahinter und umgekehrt.
pub const SITZUNG_TAGE: i64 = 7;

/// Legt eine neue Session für den Benutzer an (TTL [`SITZUNG_TAGE`]) und liefert den Token.
pub async fn anlegen(pool: &SqlitePool, benutzer_id: i64) -> Result<String, AppError> {
    let token = neuer_token();
    sqlx::query(
        "INSERT INTO session (token_hash, benutzer_id, expires_at) \
         VALUES (?, ?, datetime('now', ?))",
    )
    .bind(hash_token(&token))
    .bind(benutzer_id)
    .bind(format!("+{SITZUNG_TAGE} days"))
    .execute(pool)
    .await?;
    Ok(token)
}

/// Löscht eine Session anhand ihres Tokens (idempotent).
pub async fn loeschen(pool: &SqlitePool, token: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM session WHERE token_hash = ?")
        .bind(hash_token(token))
        .execute(pool)
        .await?;
    Ok(())
}

/// Benutzer-ID hinter einem Session-Token, ohne Gültigkeitsprüfung. Für die Audit-Spur beim
/// Logout, die den Benutzer VOR dem Löschen der Session bestimmen muss.
pub async fn benutzer_id_zu_token(pool: &SqlitePool, token: &str) -> Option<i64> {
    sqlx::query_scalar("SELECT benutzer_id FROM session WHERE token_hash = ?")
        .bind(hash_token(token))
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

/// Löst eine gültige (nicht abgelaufene) Session zu einem aktiven Benutzer auf.
pub(crate) async fn benutzer_aus_token(
    pool: &SqlitePool,
    token: &str,
) -> Result<Benutzer, AppError> {
    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT b.id, b.org_id, b.anzeigename, b.benutzername, b.passwort_hash, \
                b.system_rolle, b.org_rolle, b.aktiv, b.erstellt_at \
         FROM session s \
         JOIN benutzer b ON b.id = s.benutzer_id \
         WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND b.aktiv = 1",
    )
    .bind(hash_token(token))
    .fetch_optional(pool)
    .await?;

    benutzer.ok_or(AppError::Unauthorized)
}

/// Kopf, mit dem ein Browser-Tab bei schreibenden Anfragen den Benutzer nennt, den er anzeigt
/// (LFH-387). Das Session-Cookie gilt für den ganzen Origin; meldet sich in einem anderen Tab
/// jemand anderes an, liefe jede Schreibaktion des alten Tabs sonst still unter der neuen
/// Sitzung.
pub const ERWARTETER_BENUTZER_ID_HEADER: &str = "x-erwarteter-benutzer-id";

/// Bindet eine schreibende Anfrage an den erwarteten Benutzer.
///
/// Optional, aber strikt — dasselbe Muster wie der Queue-Besitzer aus LFH-334
/// (`routes::support::fordere_offline_queue_benutzer`): ohne Kopf bleibt alles wie bisher
/// (Skripte, Tests, ältere Frontend-Stände), ein ungültiger oder abweichender Wert ist 412.
/// Lesende Methoden sind nicht gebunden. Der Aufrufer prüft die Sitzung VORHER, damit eine tote
/// Sitzung 401 bleibt.
pub fn pruefe_erwarteten_benutzer(
    methode: &axum::http::Method,
    headers: &axum::http::HeaderMap,
    aktueller_benutzer_id: i64,
) -> Result<(), AppError> {
    if methode.is_safe() {
        return Ok(());
    }
    let Some(erwartet) = headers.get(ERWARTETER_BENUTZER_ID_HEADER) else {
        return Ok(());
    };
    let passt = erwartet
        .to_str()
        .ok()
        .and_then(|wert| wert.trim().parse::<i64>().ok())
        .is_some_and(|id| id == aktueller_benutzer_id);
    if passt {
        Ok(())
    } else {
        Err(AppError::SitzungsBenutzerMismatch)
    }
}

/// Extractor: der aktuell angemeldete Benutzer (aus Session-Cookie).
/// Liefert 401, wenn kein gültiger Session-Cookie vorliegt, und 412, wenn eine schreibende
/// Anfrage einen anderen Benutzer erwartet ([`pruefe_erwarteten_benutzer`], LFH-387). Weil
/// `AdminUser` und `EinsatzKontext` hierüber laufen, greift die Bindung an jeder
/// authentifizierten Schreibroute, vor dem Handler und damit vor jedem Idempotenz-Lookup.
pub struct CurrentUser(pub Benutzer);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_request_parts(parts, state)
            .await
            .expect("CookieJar-Extractor ist infallible");
        let token = jar
            .get(SESSION_COOKIE)
            .map(|c| c.value().to_string())
            .ok_or(AppError::Unauthorized)?;

        let benutzer = benutzer_aus_token(&state.pool, &token).await?;
        pruefe_erwarteten_benutzer(&parts.method, &parts.headers, benutzer.id)?;
        Ok(CurrentUser(benutzer))
    }
}

/// Extractor: der aktuell angemeldete Benutzer, der zusätzlich Admin sein muss.
/// Liefert 401 ohne Session, 403 bei fehlender Admin-Rolle.
pub struct AdminUser(pub Benutzer);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let CurrentUser(benutzer) = CurrentUser::from_request_parts(parts, state).await?;
        if benutzer.ist_admin() {
            Ok(AdminUser(benutzer))
        } else {
            Err(AppError::Forbidden)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Legt eine Org + einen Benutzer an und liefert dessen id.
    async fn benutzer_anlegen(pool: &SqlitePool, aktiv: i64) -> i64 {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'Max', 'max', 'hash', ?)",
        )
        .bind(aktiv)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>("SELECT id FROM benutzer WHERE benutzername = 'max'")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    fn kopf(wert: &str) -> axum::http::HeaderMap {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(ERWARTETER_BENUTZER_ID_HEADER, wert.parse().unwrap());
        headers
    }

    #[test]
    fn erwarteter_benutzer_bindet_nur_schreibende_methoden() {
        use axum::http::Method;
        let leer = axum::http::HeaderMap::new();
        for methode in [Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(pruefe_erwarteten_benutzer(&methode, &kopf("7"), 7).is_ok());
            assert!(pruefe_erwarteten_benutzer(&methode, &kopf(" 7 "), 7).is_ok());
            assert!(
                pruefe_erwarteten_benutzer(&methode, &leer, 7).is_ok(),
                "ohne Kopf bleibt alles wie bisher"
            );
            for falsch in ["8", "", "abc", "7x"] {
                assert!(
                    matches!(
                        pruefe_erwarteten_benutzer(&methode, &kopf(falsch), 7),
                        Err(AppError::SitzungsBenutzerMismatch)
                    ),
                    "{methode} mit Kopf {falsch:?} muss 412 sein"
                );
            }
        }
        for methode in [Method::GET, Method::HEAD, Method::OPTIONS] {
            assert!(
                pruefe_erwarteten_benutzer(&methode, &kopf("8"), 7).is_ok(),
                "lesende Anfragen sind nicht gebunden ({methode})"
            );
        }
    }

    #[test]
    fn cookie_secure_default_false() {
        assert!(!cookie_secure());
    }

    #[test]
    fn neuer_token_ist_64_hex_zeichen() {
        let t = neuer_token();
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(t, neuer_token(), "Tokens müssen sich unterscheiden");
    }

    #[tokio::test]
    async fn anlegen_speichert_nur_hash_nicht_klartext() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;

        let token = anlegen(&pool, id).await.unwrap();

        let gespeichert: String = sqlx::query_scalar("SELECT token_hash FROM session")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_ne!(
            gespeichert, token,
            "Der Klartext-Token darf nicht in der DB liegen"
        );
        assert_eq!(
            gespeichert,
            hash_token(&token),
            "In der DB muss der SHA-256-Hash des Tokens stehen"
        );
        // Gegenprobe: der Klartext-Token findet per Gleichheit keine Session.
        let treffer: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session WHERE token_hash = ?")
            .bind(&token)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(treffer, 0, "Klartext-Token darf keine Session matchen");
    }

    #[tokio::test]
    async fn sitzung_laeuft_nach_sitzung_tagen_ab() {
        // LFH-779: das Cookie-`Max-Age` rechnet mit derselben Konstante. Die Cookie-Tests
        // pinnen die 7 Tage bewusst als Literal: eine andere Dauer ist eine Entscheidung.
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        anlegen(&pool, id).await.unwrap();

        let tage: f64 =
            sqlx::query_scalar("SELECT julianday(expires_at) - julianday('now') FROM session")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(
            (tage - SITZUNG_TAGE as f64).abs() < 0.01,
            "Ablauf nach {SITZUNG_TAGE} Tagen erwartet, war {tage}"
        );
    }

    #[tokio::test]
    async fn hash_aus_db_taugt_nicht_als_cookie() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;

        let token = anlegen(&pool, id).await.unwrap();
        // Der Klartext-Token (aus dem Cookie) löst weiterhin auf.
        assert!(benutzer_aus_token(&pool, &token).await.is_ok());

        // Der in der DB gespeicherte Wert, als Cookie eingesetzt, löst NICHT auf.
        let gespeichert: String = sqlx::query_scalar("SELECT token_hash FROM session")
            .fetch_one(&pool)
            .await
            .unwrap();
        let err = benutzer_aus_token(&pool, &gespeichert).await.unwrap_err();
        assert!(
            matches!(err, AppError::Unauthorized),
            "Der DB-Hash darf kein gültiger Login-Schlüssel sein"
        );
    }

    #[tokio::test]
    async fn anlegen_und_aufloesen_roundtrip() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;

        let token = anlegen(&pool, id).await.unwrap();
        let benutzer = benutzer_aus_token(&pool, &token).await.unwrap();
        assert_eq!(benutzer.id, id);
        assert_eq!(benutzer.benutzername, "max");
    }

    #[tokio::test]
    async fn unbekannter_token_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        benutzer_anlegen(&pool, 1).await;
        let err = benutzer_aus_token(&pool, "gibtsnicht").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn abgelaufene_session_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        // Session mit Ablauf in der Vergangenheit direkt einfügen (Hash des Tokens "alt",
        // damit der hashende Lookup die Zeile findet und wirklich am Ablauf scheitert).
        sqlx::query(
            "INSERT INTO session (token_hash, benutzer_id, expires_at) \
             VALUES (?, ?, datetime('now', '-1 day'))",
        )
        .bind(hash_token("alt"))
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        let err = benutzer_aus_token(&pool, "alt").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn session_eines_inaktiven_benutzers_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 0).await; // inaktiv
        let token = anlegen(&pool, id).await.unwrap();
        let err = benutzer_aus_token(&pool, &token).await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn loeschen_invalidiert_session() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        let token = anlegen(&pool, id).await.unwrap();
        loeschen(&pool, &token).await.unwrap();
        let err = benutzer_aus_token(&pool, &token).await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }
}
