//! Fehler der öffentlichen API v1: `{"error": "<Text>", "code": "<code>"}` (LLH-1653, Spec
//! `oeffentliche-api-vertrag`, design.md D2).
//!
//! Vertrag ist `code`; der Text bleibt deutsche Prosa wie in der internen API (Konzept D9). v1-
//! Handler geben [`ApiError`] zurück. Was vor oder neben einem Handler scheitert (abgelehnte
//! Eingaben, unbekannter Pfad, 405, 413, Panik, Lastabwurf), bekommt seinen Code von der Schicht
//! [`super::error_code_layer`] und [`super::contract_layer`].

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::error::AppError;

crate::wire_enum::wire_enum! {
    /// Stabiler Fehlercode unter `/api/v1/`. Innerhalb von v1 kommen Codes nur hinzu; keiner wird
    /// umbenannt, umgedeutet oder entfernt. Clients überspringen unbekannte Werte.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
    pub enum ErrorCode {
        /// 400: ein Feld für sich ist ungültig (kaputtes JSON, falscher Typ, unbekannter Wert).
        InvalidField => "invalid_field",
        /// 401: die Anmeldung ist gescheitert; den Grund sieht nur der Admin.
        Unauthorized => "unauthorized",
        /// 403: dem Zugang fehlt der Scope für diese Route.
        MissingScope => "missing_scope",
        /// 403: die Route verlangt TLS.
        TlsRequired => "tls_required",
        /// 404: Pfad oder Datensatz unbekannt oder nicht freigegeben.
        NotFound => "not_found",
        /// 405: die Methode gibt es für diesen Pfad nicht.
        MethodNotAllowed => "method_not_allowed",
        /// 409: Konflikt mit dem aktuellen Zustand.
        Conflict => "conflict",
        /// 409: eine andere Instanz führt den Einsatz.
        FuehrungElsewhere => "fuehrung_elsewhere",
        /// 410: der Cursor ist älter als die Aufbewahrung der Ereignisse.
        CursorExpired => "cursor_expired",
        /// 413: der Body ist größer als 64 KiB.
        PayloadTooLarge => "payload_too_large",
        /// 422: die Felder passen nicht zusammen oder der Zustand verbietet die Anfrage.
        Unprocessable => "unprocessable",
        /// 429: zu viele Anfragen; `Retry-After` nennt die Wartezeit.
        RateLimited => "rate_limited",
        /// 500: interner Fehler.
        InternalError => "internal_error",
        /// 503: vorübergehend ausgelastet, später erneut versuchen.
        Unavailable => "unavailable",
    }
}

impl ErrorCode {
    /// Der Status, mit dem dieser Code antwortet.
    pub fn status(self) -> StatusCode {
        match self {
            ErrorCode::InvalidField => StatusCode::BAD_REQUEST,
            ErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
            ErrorCode::MissingScope | ErrorCode::TlsRequired => StatusCode::FORBIDDEN,
            ErrorCode::NotFound => StatusCode::NOT_FOUND,
            ErrorCode::MethodNotAllowed => StatusCode::METHOD_NOT_ALLOWED,
            ErrorCode::Conflict | ErrorCode::FuehrungElsewhere => StatusCode::CONFLICT,
            ErrorCode::CursorExpired => StatusCode::GONE,
            ErrorCode::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            ErrorCode::Unprocessable => StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            ErrorCode::InternalError => StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        }
    }

    /// Der Vorgabe-Code eines Fehlerstatus, wenn niemand einen ausdrücklichen gesetzt hat. Ein
    /// Status ohne eigenen Code fällt auf `unprocessable` (4xx) oder `internal_error` (5xx).
    pub fn for_status(status: StatusCode) -> ErrorCode {
        match status {
            StatusCode::BAD_REQUEST => ErrorCode::InvalidField,
            StatusCode::UNAUTHORIZED => ErrorCode::Unauthorized,
            StatusCode::FORBIDDEN => ErrorCode::MissingScope,
            StatusCode::NOT_FOUND => ErrorCode::NotFound,
            StatusCode::METHOD_NOT_ALLOWED => ErrorCode::MethodNotAllowed,
            StatusCode::CONFLICT => ErrorCode::Conflict,
            StatusCode::GONE => ErrorCode::CursorExpired,
            StatusCode::PAYLOAD_TOO_LARGE => ErrorCode::PayloadTooLarge,
            StatusCode::UNPROCESSABLE_ENTITY => ErrorCode::Unprocessable,
            StatusCode::TOO_MANY_REQUESTS => ErrorCode::RateLimited,
            StatusCode::INTERNAL_SERVER_ERROR => ErrorCode::InternalError,
            StatusCode::SERVICE_UNAVAILABLE => ErrorCode::Unavailable,
            s if s.is_server_error() => ErrorCode::InternalError,
            _ => ErrorCode::Unprocessable,
        }
    }

    /// Vorgabetext, wenn eine Fehlerantwort keinen lesbaren Text mitbringt.
    pub fn default_message(self) -> &'static str {
        match self {
            ErrorCode::InvalidField => "Ungültige Eingabe",
            ErrorCode::Unauthorized => "Nicht angemeldet",
            ErrorCode::MissingScope => "Keine Berechtigung",
            ErrorCode::TlsRequired => "Nur über TLS erreichbar",
            ErrorCode::NotFound => "Nicht gefunden",
            ErrorCode::MethodNotAllowed => "Methode für diesen Pfad nicht erlaubt",
            ErrorCode::Conflict => "Konflikt mit dem aktuellen Zustand",
            ErrorCode::FuehrungElsewhere => "Eine andere Instanz führt diesen Einsatz",
            ErrorCode::CursorExpired => "Der Cursor ist abgelaufen",
            ErrorCode::PayloadTooLarge => "Anfrage ist zu groß.",
            ErrorCode::Unprocessable => "Anfrage nicht verarbeitbar",
            ErrorCode::RateLimited => "Zu viele Anfragen",
            ErrorCode::InternalError => "Interner Serverfehler",
            ErrorCode::Unavailable => "Dienst vorübergehend ausgelastet — bitte erneut versuchen.",
        }
    }
}

/// Body jeder Fehlerantwort unter `/api/v1/`.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct ApiErrorBody {
    /// Lesbarer Text (deutsch). Kein Vertrag: Clients werten `code` aus.
    pub error: String,
    pub code: ErrorCode,
}

/// Fehler eines v1-Handlers. Antwortet mit dem Status seines Codes und `{error, code}`.
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: ErrorCode,
    pub message: String,
    /// Wartezeit in Sekunden für den Kopf `Retry-After` (429, LLH-1652).
    pub retry_after_s: Option<u64>,
}

impl ApiError {
    /// Fehler mit ausdrücklichem Code; der Status folgt dem Code.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        ApiError {
            status: code.status(),
            code,
            message: message.into(),
            retry_after_s: None,
        }
    }

    /// 429 `rate_limited` mit `Retry-After` in ganzen Sekunden (mindestens 1).
    pub fn rate_limited(retry_after_s: u64) -> Self {
        ApiError {
            retry_after_s: Some(retry_after_s.max(1)),
            ..Self::from_code(ErrorCode::RateLimited)
        }
    }

    /// Fehler mit dem Vorgabetext seines Codes.
    pub fn from_code(code: ErrorCode) -> Self {
        Self::new(code, code.default_message())
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.message, self.code.as_str())
    }
}

impl std::error::Error for ApiError {}

/// Übernimmt Status und öffentlichen Text eines [`AppError`] und gibt ihm den Vorgabe-Code seines
/// Status. Ausnahme ist der Schreibschutz eines Spiegels (LLH-1492): er heißt
/// `fuehrung_elsewhere`. Ein interner Fehler behält den generischen Text; das Detail landet über
/// [`AppError::public_message`] im Log.
impl From<AppError> for ApiError {
    fn from(err: AppError) -> Self {
        let status = err.status();
        let code = if is_spiegel_schutz(&err) {
            ErrorCode::FuehrungElsewhere
        } else {
            ErrorCode::for_status(status)
        };
        ApiError {
            status,
            code,
            message: err.public_message(),
            retry_after_s: None,
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        AppError::from(err).into()
    }
}

fn is_spiegel_schutz(err: &AppError) -> bool {
    matches!(
        err,
        AppError::Database(sqlx::Error::Database(db))
            if db.message().contains(crate::instanz::spiegel::SCHUTZ_NACHRICHT)
    )
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut resp = (
            self.status,
            Json(ApiErrorBody {
                error: self.message,
                code: self.code,
            }),
        )
            .into_response();
        if let Some(s) = self.retry_after_s {
            resp.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                axum::http::HeaderValue::from(s),
            );
        }
        resp
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    async fn body(resp: Response) -> serde_json::Value {
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[test]
    fn jeder_status_hat_seinen_vorgabe_code() {
        let cases = [
            (400, "invalid_field"),
            (401, "unauthorized"),
            (403, "missing_scope"),
            (404, "not_found"),
            (405, "method_not_allowed"),
            (409, "conflict"),
            (410, "cursor_expired"),
            (413, "payload_too_large"),
            (422, "unprocessable"),
            (429, "rate_limited"),
            (500, "internal_error"),
            (503, "unavailable"),
        ];
        for (status, code) in cases {
            let status = StatusCode::from_u16(status).unwrap();
            assert_eq!(ErrorCode::for_status(status).as_str(), code, "{status}");
        }
    }

    #[test]
    fn status_ohne_eigenen_code_faellt_auf_die_klasse() {
        assert_eq!(
            ErrorCode::for_status(StatusCode::PRECONDITION_FAILED),
            ErrorCode::Unprocessable
        );
        assert_eq!(
            ErrorCode::for_status(StatusCode::BAD_GATEWAY),
            ErrorCode::InternalError
        );
    }

    /// Ein Code antwortet mit dem Status, dessen Vorgabe er ist, oder mit dem Status der
    /// ausdrücklichen Ausnahme (`tls_required` 403, `fuehrung_elsewhere` 409).
    #[test]
    fn code_und_status_passen_zusammen() {
        for code in ErrorCode::ALLE {
            let default = ErrorCode::for_status(code.status());
            assert!(
                default == code
                    || matches!(code, ErrorCode::TlsRequired | ErrorCode::FuehrungElsewhere),
                "{} antwortet mit {}, dessen Vorgabe {} ist",
                code.as_str(),
                code.status(),
                default.as_str()
            );
        }
    }

    #[tokio::test]
    async fn ausdruecklicher_code_bleibt() {
        let resp = ApiError::new(ErrorCode::TlsRequired, "Nur über TLS").into_response();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        let json = body(resp).await;
        assert_eq!(json["code"], "tls_required");
        assert_eq!(json["error"], "Nur über TLS");
    }

    #[tokio::test]
    async fn datenbankfehler_ist_internal_error_ohne_sql() {
        let err: ApiError =
            AppError::Database(sqlx::Error::Protocol("SELECT geheim FROM tabelle".into())).into();
        let resp = err.into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let json = body(resp).await;
        assert_eq!(json["code"], "internal_error");
        assert_eq!(json["error"], "Interner Serverfehler");
    }

    #[tokio::test]
    async fn app_error_nimmt_den_vorgabe_code_seines_status() {
        let resp = ApiError::from(AppError::Validation("Feld x fehlt".into())).into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let json = body(resp).await;
        assert_eq!(json["code"], "invalid_field");
        assert_eq!(json["error"], "Feld x fehlt");

        let resp = ApiError::from(AppError::Conflict("schon da".into())).into_response();
        assert_eq!(body(resp).await["code"], "conflict");
    }

    /// Ein Datenbankfehler mit gegebenem Text, wie ihn der Trigger des Spiegel-Schutzes wirft
    /// (`migrations/0314`).
    #[derive(Debug)]
    struct TriggerError(&'static str);

    impl std::fmt::Display for TriggerError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(self.0)
        }
    }

    impl std::error::Error for TriggerError {}

    impl sqlx::error::DatabaseError for TriggerError {
        fn message(&self) -> &str {
            self.0
        }
        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    #[tokio::test]
    async fn spiegel_schutz_ist_fuehrung_elsewhere() {
        let err = AppError::Database(sqlx::Error::Database(Box::new(TriggerError(
            crate::instanz::spiegel::SCHUTZ_NACHRICHT,
        ))));
        let resp = ApiError::from(err).into_response();
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        assert_eq!(body(resp).await["code"], "fuehrung_elsewhere");
    }
}
