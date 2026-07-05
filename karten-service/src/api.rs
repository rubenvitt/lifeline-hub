use axum::{routing::get, Router};

#[derive(Clone)]
pub struct AppState {
    pub token: String,
}

pub fn router(state: AppState) -> Router {
    Router::new().route("/healthz", get(|| async { "ok" })).with_state(state)
}

#[cfg(test)]
pub fn test_state() -> AppState {
    AppState { token: "t".into() }
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;
    #[tokio::test]
    async fn healthz_ok() {
        let app = super::router(super::test_state());
        let res = app
            .oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
}
