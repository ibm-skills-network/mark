#![allow(clippy::expect_used)]

//! Database-backed checks. They run only when `DATABASE_URL` is set (CI
//! provides an ephemeral PostgreSQL); otherwise they are skipped so unit
//! tests stay runnable on a laptop with nothing else running.

use std::collections::HashMap;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use mark_platform::health::{DatabaseProbe, HealthState};
use mark_platform::{db, Config, ExecutionControls, Role};
use tower::ServiceExt;

fn database_url() -> Option<String> {
    std::env::var("DATABASE_URL").ok().filter(|v| !v.is_empty())
}

fn config(url: &str) -> Config {
    let leaked: &'static str = Box::leak(url.to_owned().into_boxed_str());
    let env = HashMap::from([("DATABASE_URL", leaked)]);
    Config::load(Role::Api, &env).expect("config loads")
}

#[tokio::test]
async fn readiness_is_ok_against_a_real_database() {
    let Some(url) = database_url() else {
        eprintln!("DATABASE_URL not set; skipping");
        return;
    };
    let pool = db::pool(&config(&url)).expect("pool builds");
    let router = HealthState::new(Role::Api, "test", ExecutionControls::default())
        .with_probe(DatabaseProbe::new(pool, Duration::from_secs(5)))
        .router();

    let response = router
        .oneshot(
            Request::get("/health/readiness")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let body: serde_json::Value = serde_json::from_slice(
        &response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes(),
    )
    .expect("json");
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["checks"][0]["name"], "database");
    assert_eq!(body["checks"][0]["status"], "ok");
}

#[tokio::test]
async fn readiness_is_503_when_the_database_is_unreachable() {
    // Port 1 is never a PostgreSQL listener; the pool connects lazily so
    // construction succeeds and only the ping fails.
    let cfg = config("postgres://nobody:nothing@127.0.0.1:1/nowhere"); // pragma: allowlist secret
    let pool = db::pool(&cfg).expect("pool builds");
    let router = HealthState::new(Role::Api, "test", ExecutionControls::default())
        .with_probe(DatabaseProbe::new(pool, Duration::from_secs(2)))
        .router();

    let response = router
        .oneshot(
            Request::get("/health/readiness")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}
