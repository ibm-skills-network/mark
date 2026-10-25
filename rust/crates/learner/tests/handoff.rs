#![allow(clippy::expect_used, clippy::unwrap_used)]

//! The internal grading API client and the LTI gateway PUT against local
//! `axum` servers standing in for the legacy API and the gateway.

use std::sync::{Arc, Mutex};

use axum::extract::{RawQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use mark_learner::internal_client::{CallError, EnqueueRequest, Enqueued, InternalApi, QueuedTier};
use mark_learner::lti::LtiGateway;
use serde_json::{json, Map, Value};

#[derive(Clone, Default)]
struct Seen(Arc<Mutex<Vec<(HeaderMap, Value)>>>);

async fn serve(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    format!("http://{addr}")
}

fn internal_mock(seen: Seen, enqueue_status: StatusCode, enqueue_body: Value) -> Router {
    Router::new()
        .route(
            "/api/internal/grading/active-job",
            get(
                |State(seen): State<Seen>, headers: HeaderMap, RawQuery(raw): RawQuery| async move {
                    let q: Map<String, Value> =
                        form_urlencoded::parse(raw.unwrap_or_default().as_bytes())
                            .map(|(k, v)| (k.into_owned(), Value::String(v.into_owned())))
                            .collect();
                    seen.0
                        .lock()
                        .unwrap()
                        .push((headers, Value::Object(q.clone())));
                    let id = if q.get("attemptId") == Some(&json!("9")) {
                        json!("job-9")
                    } else {
                        Value::Null
                    };
                    Json(json!({ "gradingJobId": id }))
                },
            ),
        )
        .route(
            "/api/internal/grading/enqueue",
            post(
                move |State(seen): State<Seen>, headers: HeaderMap, Json(body): Json<Value>| {
                    let reply = enqueue_body.clone();
                    async move {
                        seen.0.lock().unwrap().push((headers, body));
                        (enqueue_status, Json(reply))
                    }
                },
            ),
        )
        .with_state(seen)
}

fn enqueue_request() -> EnqueueRequest {
    let mut dto = Map::new();
    dto.insert("submitted".into(), json!(true));
    dto.insert(
        "responsesForQuestions".into(),
        json!([{"id": 3, "learnerTextResponse": "hello"}]),
    );
    dto.insert("language".into(), json!("fr"));
    EnqueueRequest {
        assignment_id: 5,
        attempt_id: 7,
        user_id: "l@example.com".into(),
        grading_callback_required: true,
        auth_cookie: Some("jwt-token".into()),
        submission_received_at: "2026-10-24T10:00:00.000Z".into(),
        tier: QueuedTier::Standard,
        update_dto: dto,
    }
}

#[tokio::test]
async fn active_job_sends_the_secret_and_reads_the_job() {
    let seen = Seen::default();
    let base = serve(internal_mock(seen.clone(), StatusCode::OK, json!({}))).await;
    let api = InternalApi::new(&base, "s3cret".into()).unwrap();
    assert_eq!(
        api.active_job("l@example.com", 5, 9)
            .await
            .unwrap()
            .as_deref(),
        Some("job-9")
    );
    assert_eq!(api.active_job("l@example.com", 5, 7).await.unwrap(), None);
    let calls = seen.0.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].0.get("x-job-queue-secret").unwrap(), "s3cret");
    assert_eq!(
        calls[0].1,
        json!({"userId": "l@example.com", "assignmentId": "5", "attemptId": "9"})
    );
}

#[tokio::test]
async fn enqueue_posts_the_decoded_submit() {
    let seen = Seen::default();
    let base = serve(internal_mock(
        seen.clone(),
        StatusCode::OK,
        json!({"gradingJobId": "job-1", "reused": false, "message": "ignored"}),
    ))
    .await;
    let api = InternalApi::new(&format!("{base}/"), "s3cret".into()).unwrap();
    let outcome = api.enqueue(&enqueue_request()).await.unwrap();
    assert_eq!(
        outcome,
        Enqueued::Job {
            grading_job_id: "job-1".into(),
            reused: false
        }
    );
    let calls = seen.0.lock().unwrap();
    assert_eq!(calls[0].0.get("x-job-queue-secret").unwrap(), "s3cret");
    assert_eq!(
        calls[0].1,
        json!({
            "assignmentId": 5, "attemptId": 7, "userId": "l@example.com",
            "gradingCallbackRequired": true, "authCookie": "jwt-token",
            "submissionReceivedAt": "2026-10-24T10:00:00.000Z", "tier": "standard",
            "updateDto": {"submitted": true, "responsesForQuestions": [{"id": 3, "learnerTextResponse": "hello"}], "language": "fr"}
        })
    );
}

#[tokio::test]
async fn enqueue_passes_409_and_400_through_and_fails_on_anything_else() {
    let refusal = json!({"statusCode": 409, "code": "AI_TEMPORARILY_DISABLED", "message": "This activity is temporarily out of service. Please try again later."});
    let base = serve(internal_mock(
        Seen::default(),
        StatusCode::CONFLICT,
        refusal.clone(),
    ))
    .await;
    let api = InternalApi::new(&base, "s".into()).unwrap();
    assert_eq!(
        api.enqueue(&enqueue_request()).await.unwrap(),
        Enqueued::Refused {
            status: StatusCode::CONFLICT,
            body: refusal
        }
    );

    // A 400 (the two sides disagree on the payload) reaches the learner as
    // it was sent, not as a 500.
    let invalid = json!({"message": ["responsesForQuestions.0.id must be an integer number"], "error": "Bad Request", "statusCode": 400});
    let base = serve(internal_mock(
        Seen::default(),
        StatusCode::BAD_REQUEST,
        invalid.clone(),
    ))
    .await;
    let api = InternalApi::new(&base, "s".into()).unwrap();
    assert_eq!(
        api.enqueue(&enqueue_request()).await.unwrap(),
        Enqueued::Refused {
            status: StatusCode::BAD_REQUEST,
            body: invalid
        }
    );

    let base = serve(internal_mock(
        Seen::default(),
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({"statusCode": 500}),
    ))
    .await;
    let api = InternalApi::new(&base, "s".into()).unwrap();
    assert!(matches!(
        api.enqueue(&enqueue_request()).await,
        Err(CallError::Failed(_))
    ));
}

#[tokio::test]
async fn an_unreachable_internal_api_is_retryable() {
    // Bind and drop a listener so the port is closed.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    let api = InternalApi::new(&format!("http://{addr}"), "s".into()).unwrap();
    assert!(matches!(
        api.active_job("u", 1, 1).await,
        Err(CallError::Unreachable(_))
    ));
    let err: mark_learner::error::ApiError =
        api.enqueue(&enqueue_request()).await.unwrap_err().into();
    assert_eq!(err.status(), StatusCode::SERVICE_UNAVAILABLE);
}

fn gateway_mock(seen: Seen, status: StatusCode, body: &'static str) -> Router {
    Router::new()
        .route(
            "/grade",
            put(move |State(seen): State<Seen>, headers: HeaderMap, Json(payload): Json<Value>| async move {
                seen.0.lock().unwrap().push((headers, payload));
                (status, body)
            }),
        )
        .with_state(seen)
}

#[tokio::test]
async fn lti_put_sends_the_score_with_the_session_cookie() {
    let seen = Seen::default();
    let base = serve(gateway_mock(seen.clone(), StatusCode::OK, "ok")).await;
    let gateway = LtiGateway::new(Some(format!("{base}/grade"))).unwrap();
    gateway.send(1.0, "jwt-token").await.unwrap();
    gateway.send(0.75, "jwt-token").await.unwrap();
    let calls = seen.0.lock().unwrap();
    assert_eq!(
        calls[0].0.get("cookie").unwrap(),
        "authentication=jwt-token"
    );
    assert_eq!(calls[0].1.to_string(), r#"{"score":1}"#);
    assert_eq!(calls[1].1.to_string(), r#"{"score":0.75}"#);
}

#[tokio::test]
async fn lti_failures_carry_what_the_retry_log_records() {
    let base = serve(gateway_mock(
        Seen::default(),
        StatusCode::BAD_GATEWAY,
        r#"{"message":"LMS said no"}"#,
    ))
    .await;
    let gateway = LtiGateway::new(Some(format!("{base}/grade"))).unwrap();
    let failure = gateway.send(1.0, "t").await.unwrap_err();
    assert_eq!(failure.message, "LMS said no");
    assert_eq!(failure.http_status, Some(502));
    assert_eq!(
        failure.response_body.as_deref(),
        Some(r#"{"message":"LMS said no"}"#)
    );

    let base = serve(gateway_mock(
        Seen::default(),
        StatusCode::INTERNAL_SERVER_ERROR,
        "plain",
    ))
    .await;
    let gateway = LtiGateway::new(Some(format!("{base}/grade"))).unwrap();
    let failure = gateway.send(1.0, "t").await.unwrap_err();
    assert_eq!(failure.message, "Request failed with status code 500");
    assert_eq!(failure.response_body.as_deref(), Some("plain"));

    let base = serve(gateway_mock(Seen::default(), StatusCode::CREATED, "")).await;
    let gateway = LtiGateway::new(Some(format!("{base}/grade"))).unwrap();
    let failure = gateway.send(1.0, "t").await.unwrap_err();
    assert_eq!(failure.message, "Unexpected response status: 201");
    assert_eq!(failure.http_status, None);

    let unset = LtiGateway::new(None).unwrap();
    assert!(unset.send(1.0, "t").await.is_err());
}
