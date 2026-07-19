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
    /// Zu viele Anfragen aus derselben Quelle (429), heute nur der Anmelde-Bremse
    /// (LFH-249/F30). Abgrenzung zu 503: dort kann der Server gerade generell nicht,
    /// hier darf dieser eine Aufrufer gerade nicht — und zwar vorübergehend und
    /// selbstheilend, ohne dauerhafte Sperre.
    TooManyRequests(String),
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
            AppError::TooManyRequests(m) => write!(f, "{m}"),
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
            AppError::Database(e) => {
                if Self::ist_ueberlast(e) {
                    // Überlast, kein Defekt → fachlich „später erneut versuchen" statt
                    // undurchsichtigem 500. Zwei Quellen, siehe [`AppError::ist_ueberlast`].
                    StatusCode::SERVICE_UNAVAILABLE
                } else {
                    self.constraint_violation()
                        .map(|(status, _)| status)
                        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::NotImplemented(_) => StatusCode::NOT_IMPLEMENTED,
            AppError::BadGateway(_) => StatusCode::BAD_GATEWAY,
            AppError::ServiceUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            AppError::TooManyRequests(_) => StatusCode::TOO_MANY_REQUESTS,
        }
    }

    /// `true`, wenn der DB-Fehler eine *transiente Überlast* ist statt eines Defekts —
    /// die Klasse, die als 503 („später erneut versuchen") beantwortet gehört:
    ///
    /// - **Erschöpfte Busy-Retries** (F09/LFH-240): der WAL-Writer ist dauerhaft belegt,
    ///   `write_retry!` hat nach `MAX_VERSUCHE` aufgegeben.
    /// - **Pool-Timeout** (G09/LFH-228): alle Pool-Verbindungen sind belegt, der
    ///   `acquire_timeout` (10 s, `db.rs`) ist abgelaufen. Ohne diesen Zweig fiele
    ///   `PoolTimedOut` — weder busy noch Constraint-Verletzung — auf 500 „Interner
    ///   Serverfehler" durch, d.h. Backpressure sähe aus wie ein Serverdefekt.
    ///
    /// Bewusst eine exakte Varianten-Prüfung: der Zweig sitzt auf dem zentralen
    /// `?`-Pfad ALLER Handler und darf keine andere Fehlerklasse mitreißen.
    fn ist_ueberlast(e: &sqlx::Error) -> bool {
        crate::tx::ist_busy(e) || matches!(e, sqlx::Error::PoolTimedOut)
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
                if Self::ist_ueberlast(e) {
                    // Transiente Überlast: 503, nicht 500. Dieselbe Klassifikation wie in
                    // `status()` (via `ist_ueberlast`), damit Statuscode und Meldung nicht
                    // auseinanderlaufen; nur die Log-Zeile unterscheidet die zwei Quellen,
                    // weil sie operativ verschiedene Gegenmaßnahmen nahelegen.
                    if matches!(e, sqlx::Error::PoolTimedOut) {
                        // G09/LFH-228: alle Pool-Slots belegt, acquire_timeout abgelaufen.
                        tracing::warn!("Verbindungspool erschöpft (503): {e}");
                    } else {
                        tracing::warn!("Schreibkonflikt nach Busy-Retries (503): {e}");
                    }
                    "Dienst vorübergehend ausgelastet — bitte erneut versuchen.".to_string()
                } else if let Some((_, generic)) = self.constraint_violation() {
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

    #[tokio::test]
    async fn pool_timeout_maps_to_503_and_is_generic() {
        // G09/LFH-228: ein erschöpfter Verbindungspool ist Überlast, kein Defekt.
        // Vorher fiel `PoolTimedOut` über `From<sqlx::Error>` in `Database(_)` und —
        // weder busy noch Constraint-Verletzung — auf 500 „Interner Serverfehler"
        // durch: Backpressure sah aus wie ein Serverdefekt. Jetzt ehrlicher Lastabwurf.
        let app = AppError::from(sqlx::Error::PoolTimedOut);
        assert_eq!(app.status(), StatusCode::SERVICE_UNAVAILABLE);

        let resp = app.into_response();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);

        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let msg = json["error"].as_str().unwrap();
        assert_ne!(
            msg, "Interner Serverfehler",
            "Überlast darf nicht als Serverdefekt beantwortet werden"
        );
        // Kein Internal-Detail: die sqlx-Meldung lautet „pool timed out while waiting …“.
        assert!(
            !msg.to_lowercase().contains("pool"),
            "Meldung darf kein internes Detail leaken: {msg}"
        );
    }

    #[test]
    fn andere_sqlx_fehler_bleiben_500() {
        // Abgrenzung zum neuen 503-Zweig (G09/LFH-228): der Arm sitzt auf dem zentralen
        // `?`-Pfad ALLER Handler — er darf ausschließlich `PoolTimedOut` fangen und keine
        // andere sqlx-Fehlerklasse mit in den Lastabwurf ziehen.
        assert_eq!(
            AppError::from(sqlx::Error::RowNotFound).status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            AppError::from(sqlx::Error::PoolClosed).status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
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
