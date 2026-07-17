use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Zentraler Anwendungsfehler. Wird über `IntoResponse` einheitlich
/// als JSON `{ "error": "<Meldung>" }` mit passendem Statuscode beantwortet.
#[derive(Debug)]
pub enum AppError {
    /// Nicht angemeldet / ungültige Session (401).
    Unauthorized,
    /// Angemeldet, aber keine Berechtigung (403).
    Forbidden,
    /// Ressource nicht gefunden (404).
    NotFound,
    /// Eingabe ungültig (400) — Meldung wird ausgegeben.
    Validation(String),
    /// Konflikt mit dem aktuellen Zustand (409), z.B. doppelter Benutzername.
    Conflict(String),
    /// Anfrage verstanden, aber der aktuelle Zustand verbietet sie (422),
    /// z.B. ein nicht erlaubter Status-Übergang.
    UnprocessableEntity(String),
    /// Datenbankfehler (500) — Details nur im Log, nicht in der Antwort.
    Database(sqlx::Error),
    /// Sonstiger interner Fehler (500).
    Internal(String),
    /// Feature ist nicht konfiguriert/verfügbar (501), z.B. ein nicht eingerichteter Upstream-Service.
    NotImplemented(String),
    /// Ein angesprochener Upstream-Dienst ist fehlgeschlagen/unerreichbar (502).
    BadGateway(String),
    /// Der Dienst kann die Anfrage vorübergehend nicht bedienen (503), z.B. weil eine
    /// erforderliche Abhängigkeit (Virenscanner, LFH-114) nicht erreichbar ist und
    /// fail-closed konfiguriert wurde. Signalisiert dem Client „später erneut versuchen".
    ServiceUnavailable(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Unauthorized => write!(f, "Nicht angemeldet"),
            AppError::Forbidden => write!(f, "Keine Berechtigung"),
            AppError::NotFound => write!(f, "Nicht gefunden"),
            AppError::Validation(m) => write!(f, "{m}"),
            AppError::Conflict(m) => write!(f, "{m}"),
            AppError::UnprocessableEntity(m) => write!(f, "{m}"),
            AppError::Database(e) => write!(f, "Datenbankfehler: {e}"),
            AppError::Internal(m) => write!(f, "{m}"),
            AppError::NotImplemented(m) => write!(f, "{m}"),
            AppError::BadGateway(m) => write!(f, "{m}"),
            AppError::ServiceUnavailable(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::Database(err)
    }
}

impl AppError {
    /// Statuscode für diese Fehlerart.
    pub fn status(&self) -> StatusCode {
        match self {
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Validation(_) => StatusCode::BAD_REQUEST,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::UnprocessableEntity(_) => StatusCode::UNPROCESSABLE_ENTITY,
            // Sicherheitsnetz (LFH-245): nicht vorab abgefangene Constraint-Verletzungen
            // bekommen einen fachlichen Statuscode statt eines nackten 500.
            AppError::Database(_) => self
                .constraint_violation()
                .map(|(status, _)| status)
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::NotImplemented(_) => StatusCode::NOT_IMPLEMENTED,
            AppError::BadGateway(_) => StatusCode::BAD_GATEWAY,
            AppError::ServiceUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
        }
    }

    /// Sicherheitsnetz für DB-Constraint-Verletzungen (LFH-245/F07): eine nicht
    /// explizit vorab abgefangene UNIQUE-/FK-/CHECK-Verletzung wird zu einem
    /// fachlichen Statuscode + generischer Meldung statt eines undurchsichtigen 500.
    /// UNIQUE/FK → 409 (Konflikt), CHECK → 422. Der konkrete Constraint wird nur
    /// geloggt (in `into_response`), nie an den Client ausgegeben.
    ///
    /// Per-Handler-Prechecks bleiben für präzise Meldungen zuständig; das Netz fängt
    /// Vergessenes und Races zwischen Precheck und Commit.
    fn constraint_violation(&self) -> Option<(StatusCode, &'static str)> {
        let AppError::Database(sqlx::Error::Database(db)) = self else {
            return None;
        };
        if db.is_unique_violation() {
            Some((
                StatusCode::CONFLICT,
                "Ein Eintrag mit diesen Werten existiert bereits.",
            ))
        } else if db.is_foreign_key_violation() {
            Some((
                StatusCode::CONFLICT,
                "Der Vorgang steht in Konflikt mit verknüpften Datensätzen.",
            ))
        } else if db.is_check_violation() {
            Some((
                StatusCode::UNPROCESSABLE_ENTITY,
                "Die Eingabe verletzt eine Konsistenzregel.",
            ))
        } else {
            None
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        // Server-Fehler werden geloggt, dem Client aber generisch beantwortet,
        // damit keine internen Details (SQL, Pfade) nach außen gelangen.
        let message = match &self {
            AppError::Database(e) => {
                if let Some((_, generic)) = self.constraint_violation() {
                    // Constraint-Verletzung: fachlich beantworten, das SQL-Detail
                    // (Constraint-Name, Werte) bleibt im Log.
                    tracing::warn!("Constraint-Verletzung (Sicherheitsnetz): {e}");
                    generic.to_string()
                } else {
                    tracing::error!("Datenbankfehler: {e}");
                    "Interner Serverfehler".to_string()
                }
            }
            AppError::Internal(m) => {
                tracing::error!("Interner Fehler: {m}");
                "Interner Serverfehler".to_string()
            }
            other => other.to_string(),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    /// 1-Verbindungs-In-Memory-Pool mit aktivierten Foreign Keys, damit echte
    /// Constraint-Verletzungen (UNIQUE/FK/CHECK) für das Sicherheitsnetz reproduzierbar sind.
    async fn mem_pool() -> sqlx::SqlitePool {
        use std::str::FromStr;
        let opts = sqlx::sqlite::SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn unique_violation_maps_to_409() {
        let pool = mem_pool().await;
        sqlx::query("CREATE TABLE t (k TEXT UNIQUE)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO t (k) VALUES ('a')")
            .execute(&pool)
            .await
            .unwrap();
        let err = sqlx::query("INSERT INTO t (k) VALUES ('a')")
            .execute(&pool)
            .await
            .unwrap_err();
        let app: AppError = err.into();
        assert_eq!(app.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn foreign_key_violation_maps_to_409() {
        let pool = mem_pool().await;
        sqlx::query("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE child (p INTEGER REFERENCES parent(id))")
            .execute(&pool)
            .await
            .unwrap();
        let err = sqlx::query("INSERT INTO child (p) VALUES (999)")
            .execute(&pool)
            .await
            .unwrap_err();
        let app: AppError = err.into();
        assert_eq!(app.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn check_violation_maps_to_422() {
        let pool = mem_pool().await;
        sqlx::query("CREATE TABLE t (n INTEGER CHECK (n > 0))")
            .execute(&pool)
            .await
            .unwrap();
        let err = sqlx::query("INSERT INTO t (n) VALUES (-1)")
            .execute(&pool)
            .await
            .unwrap_err();
        let app: AppError = err.into();
        assert_eq!(app.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn constraint_violation_response_is_generic_not_internal_error() {
        let pool = mem_pool().await;
        sqlx::query("CREATE TABLE t (k TEXT UNIQUE)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO t (k) VALUES ('a')")
            .execute(&pool)
            .await
            .unwrap();
        let err = sqlx::query("INSERT INTO t (k) VALUES ('a')")
            .execute(&pool)
            .await
            .unwrap_err();
        let resp = AppError::from(err).into_response();
        assert_eq!(resp.status(), StatusCode::CONFLICT);

        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        // Fachlich beantwortet, aber generisch: kein nackter 500-Text und kein SQL-Leak.
        assert_ne!(json["error"], "Interner Serverfehler");
        let msg = json["error"].as_str().unwrap();
        assert!(
            !msg.contains("UNIQUE"),
            "Meldung darf kein SQL-Detail leaken: {msg}"
        );
    }

    #[tokio::test]
    async fn unauthorized_maps_to_401() {
        let resp = AppError::Unauthorized.into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn validation_maps_to_400_with_message() {
        let resp = AppError::Validation("Passwort zu kurz".into()).into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"], "Passwort zu kurz");
    }

    #[tokio::test]
    async fn database_error_is_500_and_generic() {
        let resp = AppError::Database(sqlx::Error::RowNotFound).into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"], "Interner Serverfehler");
    }

    #[test]
    fn conflict_maps_to_409() {
        assert_eq!(
            AppError::Conflict("x".into()).status(),
            StatusCode::CONFLICT
        );
    }

    #[test]
    fn unprocessable_maps_to_422() {
        assert_eq!(
            AppError::UnprocessableEntity("Übergang nicht erlaubt".into()).status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn service_unavailable_maps_to_503() {
        // LFH-114 fail-closed: Virenscanner nicht erreichbar → 503 (später erneut versuchen).
        assert_eq!(
            AppError::ServiceUnavailable("clamd weg".into()).status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
