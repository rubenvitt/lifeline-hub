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
            AppError::Database(_) | AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
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
                tracing::error!("Datenbankfehler: {e}");
                "Interner Serverfehler".to_string()
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
}
