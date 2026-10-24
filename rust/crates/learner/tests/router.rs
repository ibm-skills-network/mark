#![allow(clippy::expect_used)]

//! Router behaviour that is decided before (or without) the database:
//! session handling, role gates, id parsing, the write switch, and the 503
//! mapping when the database is unreachable.

use std::collections::HashMap;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use mark_learner::{router, LearnerState, SubmitSettings};
use mark_platform::{db, Config, Role};
use tower::ServiceExt;

const LEARNER: &str =
    r#"{"userId":"l@example.com","role":"learner","groupId":"g","assignmentId":5}"#;

fn app(accept_operations: bool) -> Router {
    // Port 1 never answers, so a submit that got as far as the internal API
    // would see it unreachable.
    app_with(accept_operations, Some("http://127.0.0.1:1"))
}

fn app_with(accept_operations: bool, internal_url: Option<&str>) -> Router {
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
            submit: SubmitSettings::new(
                internal_url.map(|url| (url, "test-secret".to_owned())),
                None,
                vec!["learner".to_owned()],
            )
            .expect("submit settings"),
        }),
    )
}

async fn call(
    app: Router,
    method: &str,
    uri: &str,
    session: Option<&str>,
) -> (StatusCode, Option<String>, String) {
    call_with_body(app, method, uri, session, "").await
}

async fn call_with_body(
    app: Router,
    method: &str,
    uri: &str,
    session: Option<&str>,
    body: &str,
) -> (StatusCode, Option<String>, String) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(s) = session {
        req = req.header("user-session", s);
    }
    if !body.is_empty() {
        req = req.header("content-type", "application/json");
    }
    let response = app
        .oneshot(req.body(Body::from(body.to_owned())).expect("request"))
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
        ("PATCH", "/api/v2/assignments/5/attempts/9"),
        ("GET", "/api/v2/assignments/5/attempts/9/completed"),
        ("GET", "/api/v2/assignments/5/attempts/9/submission-status"),
        ("POST", "/api/v2/assignments/5/attempts/9/notify"),
        ("GET", "/api/v2/assignments/5/attempts/9/grade-sync-status"),
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
    for (method, uri) in [
        ("POST", "/api/v2/assignments/5/attempts"),
        ("POST", "/api/v2/assignments/5/attempts/9/abandon"),
        ("PATCH", "/api/v2/assignments/5/attempts/9"),
        ("GET", "/api/v2/assignments/5/attempts/9/completed"),
        ("GET", "/api/v2/assignments/5/attempts/9/submission-status"),
        ("POST", "/api/v2/assignments/5/attempts/9/notify"),
        ("GET", "/api/v2/assignments/5/attempts/9/grade-sync-status"),
    ] {
        let (status, retry, body) = call(app(false), method, uri, Some(LEARNER)).await;
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
        ("PATCH", "/api/v2/assignments/5/attempts/9"),
        ("GET", "/api/v2/assignments/5/attempts/9/completed"),
        ("GET", "/api/v2/assignments/5/attempts/9/submission-status"),
        ("POST", "/api/v2/assignments/5/attempts/9/notify"),
        ("GET", "/api/v2/assignments/5/attempts/9/grade-sync-status"),
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

#[tokio::test]
async fn submit_needs_the_internal_grading_api() {
    let (status, retry, body) = call_with_body(
        app_with(true, None),
        "PATCH",
        "/api/v2/assignments/5/attempts/9",
        Some(LEARNER),
        r#"{"submitted":true,"responsesForQuestions":[]}"#,
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(retry.as_deref(), Some("1"));
    assert_eq!(
        body,
        r#"{"statusCode":503,"message":"Service temporarily unavailable"}"#
    );
    // The side routes do not need it.
    let (status, _, _) = call(
        app_with(true, None),
        "GET",
        "/api/v2/assignments/5/attempts/9/submission-status",
        Some(LEARNER),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn submit_route_ids_and_roles_are_checked_before_the_database() {
    let author = r#"{"userId":"a@example.com","role":"author","assignmentId":5}"#;
    for (method, uri) in [
        ("PATCH", "/api/v2/assignments/5/attempts/9"),
        ("GET", "/api/v2/assignments/5/attempts/9/submission-status"),
        ("POST", "/api/v2/assignments/5/attempts/9/notify"),
    ] {
        let (status, _, body) = call(app(true), method, uri, Some(author)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
        assert!(body.contains("Forbidden resource"), "{body}");
    }
    // Authors may read results and sync status (then the database answers).
    for uri in [
        "/api/v2/assignments/5/attempts/9/completed",
        "/api/v2/assignments/5/attempts/9/grade-sync-status",
    ] {
        let (status, _, _) = call(app(true), "GET", uri, Some(author)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{uri}");
    }
    for (method, uri, message) in [
        (
            "PATCH",
            "/api/v2/assignments/05/attempts/9",
            "Invalid assignment ID",
        ),
        (
            "PATCH",
            "/api/v2/assignments/5/attempts/0",
            "Invalid attempt ID",
        ),
        (
            "GET",
            "/api/v2/assignments/5/attempts/1.5/completed",
            "Invalid attempt ID",
        ),
        (
            "GET",
            "/api/v2/assignments/x/attempts/9/submission-status",
            "Invalid assignment ID",
        ),
        (
            "POST",
            "/api/v2/assignments/5/attempts/2147483648/notify",
            "Invalid attempt ID",
        ),
        (
            "GET",
            "/api/v2/assignments/-5/attempts/9/grade-sync-status",
            "Invalid assignment ID",
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

#[tokio::test]
async fn submit_body_must_be_json() {
    let (status, _, body) = call_with_body(
        app(true),
        "PATCH",
        "/api/v2/assignments/5/attempts/9",
        Some(LEARNER),
        "{not json",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("not valid JSON"), "{body}");
    let (status, _, _) = call_with_body(
        app(true),
        "PATCH",
        "/api/v2/assignments/5/attempts/9",
        None,
        "{}",
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn submit_accepts_bodies_above_the_default_limit() {
    // 3 MB of answer text gets past the extractor (then the database is
    // unreachable); the default 2 MB limit would have answered 413.
    let text = "a".repeat(3 * 1024 * 1024);
    let body = format!(
        r#"{{"submitted":true,"responsesForQuestions":[{{"id":1,"learnerTextResponse":"{text}"}}]}}"#
    );
    let (status, _, _) = call_with_body(
        app(true),
        "PATCH",
        "/api/v2/assignments/5/attempts/9",
        Some(LEARNER),
        &body,
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}
