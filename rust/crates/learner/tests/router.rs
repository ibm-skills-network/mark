#![allow(clippy::expect_used)]

//! Router behaviour that is decided before (or without) the database:
//! session handling, role gates, id parsing, the write switch, and the 503
//! mapping when the database is unreachable.

use std::collections::HashMap;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use mark_learner::{router, LearnerState};
use mark_platform::{db, Config, Role};
use tower::ServiceExt;

const LEARNER: &str =
    r#"{"userId":"l@example.com","role":"learner","groupId":"g","assignmentId":5}"#;

fn app(accept_operations: bool) -> Router {
    // Port 1 never answers; the pool connects lazily so only queries fail.
    let env = HashMap::from([
        (
            "DATABASE_URL",
            "postgres://nobody:nothing@127.0.0.1:1/nowhere", // pragma: allowlist secret
        ),
        ("DATABASE_CONNECT_TIMEOUT_MS", "500"),
    ]);
    let config = Config::load(Role::Api, &env).expect("config");
    let pool = db::pool(&config).expect("pool");
    Router::new().nest(
        "/api/v2",
        router(LearnerState {
            pool,
            accept_operations,
        }),
    )
}

async fn call(
    app: Router,
    method: &str,
    uri: &str,
    session: Option<&str>,
) -> (StatusCode, Option<String>, String) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(s) = session {
        req = req.header("user-session", s);
    }
    let response = app
        .oneshot(req.body(Body::empty()).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let retry = response
        .headers()
        .get("retry-after")
        .map(|v| v.to_str().expect("ascii").to_owned());
    let body = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    (
        status,
        retry,
        String::from_utf8(body.to_vec()).expect("utf8"),
    )
}

#[tokio::test]
async fn missing_session_is_401() {
    let (status, _, body) = call(app(false), "GET", "/api/v2/assignments/5", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(body.contains("Missing or invalid user session"), "{body}");
}

#[tokio::test]
async fn garbage_session_is_400() {
    let (status, _, body) = call(app(false), "GET", "/api/v2/assignments/5", Some("{x")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("Invalid user-session header"), "{body}");
}

#[tokio::test]
async fn admin_is_403_everywhere() {
    let admin = r#"{"userId":"a@example.com","role":"admin"}"#;
    for (method, uri) in [
        ("GET", "/api/v2/assignments/5"),
        ("GET", "/api/v2/assignments/5/languages"),
        ("GET", "/api/v2/assignments/5/attempts"),
        ("POST", "/api/v2/assignments/5/attempts"),
        ("GET", "/api/v2/assignments/5/attempts/9"),
        ("POST", "/api/v2/assignments/5/attempts/9/abandon"),
    ] {
        let (status, _, body) = call(app(true), method, uri, Some(admin)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
        assert!(body.contains("Forbidden resource"), "{body}");
    }
}

#[tokio::test]
async fn id_parsing_rules() {
    let (status, _, body) = call(app(false), "GET", "/api/v2/assignments/abc", Some(LEARNER)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("numeric string is expected"), "{body}");
    let (status, _, body) = call(
        app(false),
        "GET",
        "/api/v2/assignments/05/attempts",
        Some(LEARNER),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body.contains("Invalid assignment ID"), "{body}");
    let (status, _, body) = call(
        app(false),
        "GET",
        "/api/v2/assignments/5/attempts/1e3",
        Some(LEARNER),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body.contains("Invalid attempt ID"), "{body}");
}

#[tokio::test]
async fn authors_cannot_create() {
    let author = r#"{"userId":"a@example.com","role":"author","assignmentId":5}"#;
    let (status, _, _) = call(
        app(true),
        "POST",
        "/api/v2/assignments/5/attempts",
        Some(author),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn writes_are_refused_when_disabled() {
    for uri in [
        "/api/v2/assignments/5/attempts",
        "/api/v2/assignments/5/attempts/9/abandon",
    ] {
        let (status, retry, body) = call(app(false), "POST", uri, Some(LEARNER)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(retry.as_deref(), Some("1"));
        assert_eq!(
            body,
            r#"{"statusCode":503,"message":"Service temporarily unavailable"}"#
        );
    }
}

#[tokio::test]
async fn unreachable_database_is_503_with_retry_after() {
    for (method, uri) in [
        ("GET", "/api/v2/assignments/5"),
        ("GET", "/api/v2/assignments/5/attempts"),
        ("POST", "/api/v2/assignments/5/attempts"),
        ("GET", "/api/v2/assignments/5/attempts/9?lang=fr"),
    ] {
        let (status, retry, body) = call(app(true), method, uri, Some(LEARNER)).await;
        assert_eq!(
            status,
            StatusCode::SERVICE_UNAVAILABLE,
            "{method} {uri}: {body}"
        );
        assert_eq!(retry.as_deref(), Some("1"));
        assert_eq!(
            body,
            r#"{"statusCode":503,"message":"Service temporarily unavailable"}"#
        );
    }
}

#[tokio::test]
async fn impossible_ids_are_answered_before_the_database() {
    // The database is unreachable, so any query would answer 503.
    for uri in [
        "/api/v2/assignments/0",
        "/api/v2/assignments/2147483648",
        "/api/v2/assignments/0/languages",
        "/api/v2/assignments/2147483648/languages",
    ] {
        let (status, _, body) = call(app(true), "GET", uri, Some(LEARNER)).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
        assert_eq!(
            body, r#"{"message":"Assignment not found","error":"Not Found","statusCode":404}"#,
            "{uri}"
        );
    }
    for (method, uri, message) in [
        (
            "GET",
            "/api/v2/assignments/0/attempts",
            "Invalid assignment ID",
        ),
        (
            "POST",
            "/api/v2/assignments/2147483648/attempts",
            "Invalid assignment ID",
        ),
        (
            "GET",
            "/api/v2/assignments/2147483648/attempts/9",
            "Invalid assignment ID",
        ),
        (
            "GET",
            "/api/v2/assignments/5/attempts/0",
            "Invalid attempt ID",
        ),
        (
            "POST",
            "/api/v2/assignments/5/attempts/2147483648/abandon",
            "Invalid attempt ID",
        ),
    ] {
        let (status, _, body) = call(app(true), method, uri, Some(LEARNER)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
        assert_eq!(
            body,
            format!(r#"{{"message":"{message}","error":"Forbidden","statusCode":403}}"#),
            "{method} {uri}"
        );
    }
}
