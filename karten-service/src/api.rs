use axum::{extract::{State, Path}, http::{StatusCode, HeaderMap}, routing::{get, post}, Json, Router};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use crate::{jobs::{Registry, BuildJob}, regions, build::BuildRunner, storage::Storage, manifest::PublishedVersion};

#[derive(Clone)]
pub struct AppState {
    pub token: String,
    pub registry: Registry,
    pub storage: Arc<dyn Storage>,
    pub runner: Arc<dyn BuildRunner>,
    pub bestand: Arc<Mutex<Vec<PublishedVersion>>>,
}
#[derive(Deserialize)] struct BuildReq { slug: String }

fn auth(h:&HeaderMap, token:&str) -> bool {
    !token.is_empty() && h.get("authorization").and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer ")) == Some(token)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/builds", post(trigger).get(liste))
        .route("/builds/{id}", get(einzeln))
        .with_state(state)
}

async fn trigger(State(st):State<AppState>, headers:HeaderMap, Json(req):Json<BuildReq>) -> (StatusCode, Json<serde_json::Value>) {
    if !auth(&headers, &st.token) { return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"unauthorized"}))); }
    let Some(reg) = regions::finde(&req.slug) else {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"unbekannter slug"}))); };
    match st.registry.enqueue(reg.slug) {   // NICHT spawnen — der Worker fährt
        Ok(id) => (StatusCode::ACCEPTED, Json(serde_json::json!({"job_id": id}))),
        Err(_) => (StatusCode::CONFLICT, Json(serde_json::json!({"error":"queue voll"}))),
    }
}
async fn liste(State(st):State<AppState>, headers:HeaderMap) -> Result<Json<Vec<BuildJob>>, StatusCode> {
    if !auth(&headers, &st.token) { return Err(StatusCode::UNAUTHORIZED); }
    Ok(Json(st.registry.alle()))
}
async fn einzeln(State(st):State<AppState>, headers:HeaderMap, Path(id):Path<u64>) -> Result<Json<BuildJob>, StatusCode> {
    if !auth(&headers, &st.token) { return Err(StatusCode::UNAUTHORIZED); }
    st.registry.get(id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

#[cfg(test)]
pub fn test_state() -> AppState {
    AppState { token:"t".into(), registry:Registry::neu(4),
        storage:Arc::new(crate::storage::FakeStorage::neu("https://cdn.example/maps")),
        runner:Arc::new(TestRunner), bestand:Arc::new(Mutex::new(Vec::new())) }
}
#[cfg(test)]
struct TestRunner;
#[cfg(test)]
#[async_trait::async_trait]
impl BuildRunner for TestRunner {
    async fn baue(&self, _a:&str)->anyhow::Result<crate::build::BuildArtefakt> {
        anyhow::bail!("test runner baut nicht") // API-Tests brauchen keinen echten Bau
    }
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

    mod api_tests {
        use axum::{body::Body, http::{Request, StatusCode}};
        use tower::ServiceExt;
        fn post(uri:&str, token:Option<&str>, json:&str) -> Request<Body> {
            let mut b = Request::builder().method("POST").uri(uri).header("content-type","application/json");
            if let Some(t)=token { b = b.header("authorization", format!("Bearer {t}")); }
            b.body(Body::from(json.to_string())).unwrap()
        }
        #[tokio::test]
        async fn ohne_token_401() {
            let app = super::super::router(super::super::test_state());
            let r = app.oneshot(post("/builds", None, r#"{"slug":"bayern"}"#)).await.unwrap();
            assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
        }
        #[tokio::test]
        async fn unbekannter_slug_400() {
            let app = super::super::router(super::super::test_state());
            let r = app.oneshot(post("/builds", Some("t"), r#"{"slug":"atlantis"}"#)).await.unwrap();
            assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        }
        #[tokio::test]
        async fn gueltiger_trigger_202() {
            let app = super::super::router(super::super::test_state());
            let r = app.oneshot(post("/builds", Some("t"), r#"{"slug":"bayern"}"#)).await.unwrap();
            assert_eq!(r.status(), StatusCode::ACCEPTED);
        }
    }
}
