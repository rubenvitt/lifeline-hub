use crate::{
    build::BuildRunner,
    jobs::{BuildJob, Registry},
    manifest::PublishedVersion,
    regions,
    storage::Storage,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use karten_katalog::Zeitplan;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tokio_cron_scheduler::JobScheduler;

#[derive(Clone)]
pub struct AppState {
    pub token: String,
    pub registry: Registry,
    pub storage: Arc<dyn Storage>,
    pub runner: Arc<dyn BuildRunner>,
    pub bestand: Arc<Mutex<Vec<PublishedVersion>>>,
    pub zeitplan: ZeitplanQuelle,
}

/// Woraus `GET /zeitplan` antwortet (LFH-993): der Cron-Ausdruck und, im Modus `serve`, der
/// laufende Scheduler samt Job-ID. Ohne Scheduler fehlt der nächste Lauf.
#[derive(Clone)]
pub struct ZeitplanQuelle {
    pub cron: String,
    pub scheduler: Option<(JobScheduler, uuid::Uuid)>,
}
#[derive(Deserialize)]
struct BuildReq {
    slug: String,
}

fn auth(h: &HeaderMap, token: &str) -> bool {
    !token.is_empty()
        && h.get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            == Some(token)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/regions", get(regions_liste))
        .route("/builds", post(trigger).get(liste))
        .route("/builds/{id}", get(einzeln))
        .route("/zeitplan", get(zeitplan))
        .with_state(state)
}

async fn trigger(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<BuildReq>,
) -> (StatusCode, Json<serde_json::Value>) {
    if !auth(&headers, &st.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        );
    }
    let Some(reg) = regions::finde(&req.slug) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":"unbekannter slug"})),
        );
    };
    match st.registry.enqueue(reg.slug) {
        // NICHT spawnen — der Worker fährt
        Ok(id) => (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({"job_id": id})),
        ),
        Err(_) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error":"queue voll"})),
        ),
    }
}
async fn liste(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<BuildJob>>, StatusCode> {
    if !auth(&headers, &st.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Json(st.registry.alle()))
}
async fn einzeln(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<u64>,
) -> Result<Json<BuildJob>, StatusCode> {
    if !auth(&headers, &st.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    st.registry.get(id).map(Json).ok_or(StatusCode::NOT_FOUND)
}
async fn zeitplan(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Zeitplan>, StatusCode> {
    if !auth(&headers, &st.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let naechster_lauf = match st.zeitplan.scheduler {
        // `next_tick_for_job` will `&mut self`; der Klon teilt sich den Scheduler-Kontext.
        Some((mut sched, id)) => sched
            .next_tick_for_job(id)
            .await
            .ok()
            .flatten()
            .map(|t| t.to_rfc3339()),
        None => None,
    };
    Ok(Json(Zeitplan {
        naechster_lauf,
        cron: st.zeitplan.cron.clone(),
    }))
}
async fn regions_liste(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<regions::RegionDto>>, StatusCode> {
    if !auth(&headers, &st.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Json(regions::dtos()))
}

#[cfg(test)]
pub fn test_state() -> AppState {
    AppState {
        token: "t".into(),
        registry: Registry::neu(4),
        storage: Arc::new(crate::storage::FakeStorage::neu("https://cdn.example/maps")),
        runner: Arc::new(TestRunner),
        bestand: Arc::new(Mutex::new(Vec::new())),
        zeitplan: ZeitplanQuelle {
            cron: "0 0 3 1 1,4,7,10 *".into(),
            scheduler: None,
        },
    }
}
#[cfg(test)]
struct TestRunner;
#[cfg(test)]
#[async_trait::async_trait]
impl BuildRunner for TestRunner {
    async fn baue(&self, _a: &str) -> anyhow::Result<crate::build::BuildArtefakt> {
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
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    mod api_tests {
        use axum::{
            body::Body,
            http::{Request, StatusCode},
        };
        use tower::ServiceExt;
        fn post(uri: &str, token: Option<&str>, json: &str) -> Request<Body> {
            let mut b = Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json");
            if let Some(t) = token {
                b = b.header("authorization", format!("Bearer {t}"));
            }
            b.body(Body::from(json.to_string())).unwrap()
        }
        #[tokio::test]
        async fn ohne_token_401() {
            let app = super::super::router(super::super::test_state());
            let r = app
                .oneshot(post("/builds", None, r#"{"slug":"bayern"}"#))
                .await
                .unwrap();
            assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
        }
        #[tokio::test]
        async fn unbekannter_slug_400() {
            let app = super::super::router(super::super::test_state());
            let r = app
                .oneshot(post("/builds", Some("t"), r#"{"slug":"atlantis"}"#))
                .await
                .unwrap();
            assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        }
        #[tokio::test]
        async fn gueltiger_trigger_202() {
            let app = super::super::router(super::super::test_state());
            let r = app
                .oneshot(post("/builds", Some("t"), r#"{"slug":"bayern"}"#))
                .await
                .unwrap();
            assert_eq!(r.status(), StatusCode::ACCEPTED);
        }
        fn get(uri: &str, token: Option<&str>) -> Request<Body> {
            let mut b = Request::builder().method("GET").uri(uri);
            if let Some(t) = token {
                b = b.header("authorization", format!("Bearer {t}"));
            }
            b.body(Body::empty()).unwrap()
        }
        async fn json(r: axum::response::Response) -> serde_json::Value {
            let bytes = axum::body::to_bytes(r.into_body(), 1 << 20).await.unwrap();
            serde_json::from_slice(&bytes).unwrap()
        }
        // LFH-993: `GET /zeitplan` nennt den nächsten Cron-Lauf.
        #[tokio::test]
        async fn zeitplan_ohne_token_401() {
            let app = super::super::router(super::super::test_state());
            let r = app.oneshot(get("/zeitplan", None)).await.unwrap();
            assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
            let app = super::super::router(super::super::test_state());
            let r = app.oneshot(get("/zeitplan", Some("falsch"))).await.unwrap();
            assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
        }
        #[tokio::test]
        async fn zeitplan_ohne_scheduler_hat_keinen_lauf() {
            let app = super::super::router(super::super::test_state());
            let r = app.oneshot(get("/zeitplan", Some("t"))).await.unwrap();
            assert_eq!(r.status(), StatusCode::OK);
            let v = json(r).await;
            assert_eq!(v["cron"], "0 0 3 1 1,4,7,10 *");
            assert!(
                v.get("naechster_lauf").is_none(),
                "ohne Scheduler kein Lauf: {v}"
            );
        }
        #[tokio::test]
        async fn zeitplan_mit_scheduler_nennt_naechsten_lauf() {
            let cron = "0 0 3 1 1,4,7,10 *";
            let (sched, id) = crate::scheduler::starte(cron, || {}).await.unwrap();
            let mut st = super::super::test_state();
            st.zeitplan = super::super::ZeitplanQuelle {
                cron: cron.into(),
                scheduler: Some((sched, id)),
            };
            let r = super::super::router(st)
                .oneshot(get("/zeitplan", Some("t")))
                .await
                .unwrap();
            assert_eq!(r.status(), StatusCode::OK);
            let v = json(r).await;
            let lauf = v["naechster_lauf"]
                .as_str()
                .expect("naechster_lauf gesetzt");
            let lauf = chrono::DateTime::parse_from_rfc3339(lauf).expect("RFC 3339");
            assert!(lauf > chrono::Utc::now());
        }
        #[tokio::test]
        async fn regions_listet_baubare() {
            use axum::{
                body::Body,
                http::{Request, StatusCode},
            };
            use tower::ServiceExt;
            let app = super::super::router(super::super::test_state());
            let req = Request::builder()
                .method("GET")
                .uri("/regions")
                .header("authorization", "Bearer t")
                .body(Body::empty())
                .unwrap();
            let r = app.oneshot(req).await.unwrap();
            assert_eq!(r.status(), StatusCode::OK);
            let bytes = axum::body::to_bytes(r.into_body(), 1 << 20).await.unwrap();
            let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert!(v.as_array().unwrap().iter().any(|e| e["slug"] == "germany"));
        }
    }
}
