#![allow(clippy::expect_used, clippy::unwrap_used, clippy::too_many_lines)]

//! The submit routes end to end against a migrated database, with local
//! servers standing in for the legacy API's internal grading endpoints and
//! the LTI gateway.
//!
//! This test writes fixture rows (and removes them again), so it runs only
//! when `MARK_LEARNER_FIXTURE_DB=1` is set next to `DATABASE_URL`. Never
//! point it at a shared database.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::{RawQuery, State};
use axum::http::{Request, StatusCode};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use base64::Engine;
use http_body_util::BodyExt;
use mark_learner::internal_client::InternalApi;
use mark_learner::lti::LtiGateway;
use mark_learner::{router, LearnerState, SubmitSettings};
use mark_platform::{db, Config, Role};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use tower::ServiceExt;

const USER: &str = "rust-submit-flow@example.com";
const GROUP: &str = "rust-submit-flow-fixture";
const NAME: &str = "rust submit flow fixture";
const LTI_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

fn b64(s: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(s)
}

async fn exec(pool: &PgPool, sql: &str) {
    let mut tx = pool.begin().await.expect("begin");
    sqlx::raw_sql(sqlx::AssertSqlSafe(sql.to_owned()))
        .execute(&mut *tx)
        .await
        .expect(sql);
    tx.commit().await.expect("commit");
}

async fn scalar_i32(pool: &PgPool, sql: &str) -> i32 {
    let mut tx = pool.begin().await.expect("begin");
    let v: i32 = sqlx::query(sqlx::AssertSqlSafe(sql.to_owned()))
        .persistent(false)
        .fetch_one(&mut *tx)
        .await
        .expect(sql)
        .try_get(0)
        .expect("column");
    tx.commit().await.expect("commit");
    v
}

async fn row_json(pool: &PgPool, sql: &str) -> Value {
    let mut tx = pool.begin().await.expect("begin");
    let v: Value = sqlx::query(sqlx::AssertSqlSafe(sql.to_owned()))
        .persistent(false)
        .fetch_one(&mut *tx)
        .await
        .expect(sql)
        .try_get(0)
        .expect("column");
    tx.commit().await.expect("commit");
    v
}

async fn cleanup(pool: &PgPool) {
    exec(
        pool,
        &format!(
            r#"DELETE FROM "QuestionResponse" WHERE "assignmentAttemptId" IN (SELECT id FROM "AssignmentAttempt" WHERE "userId" = '{USER}');
               DELETE FROM "AssignmentAttempt" WHERE "userId" = '{USER}';
               DELETE FROM "UserNotification" WHERE "userId" = '{USER}';
               UPDATE "Assignment" SET "currentVersionId" = NULL WHERE name = '{NAME}';
               DELETE FROM "Assignment" WHERE name = '{NAME}';
               DELETE FROM "Group" WHERE id = '{GROUP}';"#
        ),
    )
    .await;
}

struct Fixture {
    assignment: i32,
    inline_attempt: i32,
    late_attempt: i32,
    queued_attempt: i32,
    second_inline_attempt: i32,
    timeout_attempt: i32,
    fallback_attempt: i32,
    q_single: i32,
    q_multi: i32,
    q_tf: i32,
}

async fn setup(pool: &PgPool) -> Fixture {
    cleanup(pool).await;
    let assignment = scalar_i32(
        pool,
        &format!(
            r#"INSERT INTO "Assignment" (name, published, type, "updatedAt") VALUES ('{NAME}', true, 'AI_GRADED', now()) RETURNING id"#
        ),
    )
    .await;
    exec(
        pool,
        &format!(
            r#"INSERT INTO "Group" (id) VALUES ('{GROUP}') ON CONFLICT DO NOTHING;
               INSERT INTO "AssignmentGroup" ("assignmentId", "groupId") VALUES ({assignment}, '{GROUP}');"#
        ),
    )
    .await;
    let question = |kind: &str, points: i32, choices: Value| {
        format!(
            r#"INSERT INTO "Question" ("assignmentId", question, type, "totalPoints", choices) VALUES ({assignment}, 'Q', '{kind}', {points}, '{choices}') RETURNING id"#
        )
    };
    let single_choices = json!([
        {"id": 1, "choice": "Paris", "isCorrect": true, "points": 2},
        {"id": 2, "choice": "Lyon", "isCorrect": false, "points": 0}
    ]);
    let multi_choices = json!([
        {"id": 1, "choice": "Red", "isCorrect": true, "points": 1},
        {"id": 2, "choice": "Blue", "isCorrect": false, "points": 1},
        {"id": 3, "choice": "Green", "isCorrect": true, "points": 1}
    ]);
    let tf_choices = json!([
        {"choice": "True", "isCorrect": false, "points": 0},
        {"choice": "False", "isCorrect": true, "points": 1}
    ]);
    let q_single = scalar_i32(pool, &question("SINGLE_CORRECT", 2, single_choices.clone())).await;
    let q_multi = scalar_i32(
        pool,
        &question("MULTIPLE_CORRECT", 2, multi_choices.clone()),
    )
    .await;
    let q_tf = scalar_i32(pool, &question("TRUE_FALSE", 1, tf_choices.clone())).await;
    let q_text = scalar_i32(pool, &question("TEXT", 3, json!([]))).await;
    let version = |label: &str| {
        format!(
            r#"INSERT INTO "AssignmentVersion" ("assignmentId", "createdBy", name, type, "versionNumber", "correctAnswerVisibility")
               VALUES ({assignment}, 'author@example.com', 'v', 'AI_GRADED', '{label}', 'ALWAYS') RETURNING id"#
        )
    };
    let v_inline = scalar_i32(pool, &version("1.0.0")).await;
    let v_queued = scalar_i32(pool, &version("2.0.0")).await;
    let qv = |v: i32, q: i32, kind: &str, points: i32, choices: &Value, order: i32| {
        format!(
            r#"INSERT INTO "QuestionVersion" ("assignmentVersionId", "questionId", question, type, "totalPoints", choices, "displayOrder")
               VALUES ({v}, {q}, 'Q', '{kind}', {points}, '{choices}', {order});"#
        )
    };
    exec(
        pool,
        &[
            qv(v_inline, q_single, "SINGLE_CORRECT", 2, &single_choices, 1),
            qv(v_inline, q_multi, "MULTIPLE_CORRECT", 2, &multi_choices, 2),
            qv(v_inline, q_tf, "TRUE_FALSE", 1, &tf_choices, 3),
            qv(v_queued, q_single, "SINGLE_CORRECT", 2, &single_choices, 1),
            qv(v_queued, q_text, "TEXT", 3, &json!([]), 2),
            format!(r#"UPDATE "Assignment" SET "currentVersionId" = {v_inline} WHERE id = {assignment};"#),
            format!(
                r#"INSERT INTO "Translation" ("questionId", "languageCode", "translatedText", "translatedChoices")
                   VALUES ({q_single}, 'fr', 'Q-fr', '{}');"#,
                json!([
                    {"id": 1, "choice": "Paris (fr)", "isCorrect": true, "points": 2},
                    {"id": 2, "choice": "Lyon (fr)", "isCorrect": false, "points": 0}
                ])
            ),
        ]
        .concat(),
    )
    .await;
    let attempt = |v: i32, order: &str, expires: &str| {
        format!(
            r#"INSERT INTO "AssignmentAttempt" ("assignmentId", "assignmentVersionId", "userId", submitted, "questionOrder", "expiresAt")
               VALUES ({assignment}, {v}, '{USER}', false, '{order}', {expires}) RETURNING id"#
        )
    };
    let order = format!("{{{q_single},{q_multi},{q_tf}}}");
    let inline_attempt = scalar_i32(pool, &attempt(v_inline, &order, "NULL")).await;
    let late_attempt = scalar_i32(
        pool,
        &attempt(
            v_inline,
            &order,
            "(now() AT TIME ZONE 'UTC') - interval '1 hour'",
        ),
    )
    .await;
    let queued_attempt = scalar_i32(
        pool,
        &attempt(v_queued, &format!("{{{q_single},{q_text}}}"), "NULL"),
    )
    .await;
    let second_inline_attempt = scalar_i32(pool, &attempt(v_inline, &order, "NULL")).await;
    let timeout_attempt = scalar_i32(pool, &attempt(v_inline, &order, "NULL")).await;
    // Pinned to the choice-only version, but serving a live TEXT question
    // the version does not hold.
    let fallback_attempt = scalar_i32(
        pool,
        &attempt(
            v_inline,
            &format!("{{{q_single},{q_multi},{q_tf},{q_text}}}"),
            "NULL",
        ),
    )
    .await;
    Fixture {
        assignment,
        inline_attempt,
        late_attempt,
        queued_attempt,
        second_inline_attempt,
        timeout_attempt,
        fallback_attempt,
        q_single,
        q_multi,
        q_tf,
    }
}

#[derive(Clone, Default)]
struct Mocks {
    enqueued: Arc<Mutex<Vec<Value>>>,
    active_lookups: Arc<AtomicUsize>,
    lti_calls: Arc<Mutex<Vec<(String, Value)>>>,
}

async fn serve(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move { axum::serve(listener, app).await.expect("serve") });
    format!("http://{addr}")
}

async fn start_mocks(mocks: Mocks) -> (String, String) {
    let internal = Router::new()
        .route(
            "/api/internal/grading/active-job",
            get(|State(m): State<Mocks>, RawQuery(_q): RawQuery| async move {
                m.active_lookups.fetch_add(1, Ordering::SeqCst);
                Json(json!({"gradingJobId": null}))
            }),
        )
        .route(
            "/api/internal/grading/enqueue",
            post(|State(m): State<Mocks>, Json(body): Json<Value>| async move {
                let drift = body["updateDto"]["language"] == "de";
                m.enqueued.lock().unwrap().push(body);
                if drift {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({"message": ["language must be one of the following values: en"], "error": "Bad Request", "statusCode": 400})),
                    );
                }
                (
                    StatusCode::OK,
                    Json(json!({"gradingJobId": "11111111-2222-3333-4444-555555555555", "reused": false})),
                )
            }),
        )
        .with_state(mocks.clone());
    let gateway = Router::new()
        .route(
            "/grade",
            put(
                |State(m): State<Mocks>,
                 headers: axum::http::HeaderMap,
                 Json(body): Json<Value>| async move {
                    let cookie = headers
                        .get("cookie")
                        .map(|v| v.to_str().unwrap().to_owned())
                        .unwrap_or_default();
                    let call = {
                        let mut calls = m.lti_calls.lock().unwrap();
                        calls.push((cookie, body));
                        calls.len()
                    };
                    // The first passback fails, the third outlives the
                    // client's timeout, the others succeed.
                    match call {
                        1 => (StatusCode::BAD_GATEWAY, r#"{"message":"LMS unavailable"}"#),
                        3 => {
                            tokio::time::sleep(LTI_TIMEOUT * 3).await;
                            (StatusCode::OK, "late")
                        }
                        _ => (StatusCode::OK, "ok"),
                    }
                },
            ),
        )
        .with_state(mocks);
    (
        serve(internal).await,
        format!("{}/grade", serve(gateway).await),
    )
}

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, String) {
    let session = format!(
        r#"{{"userId":"{USER}","role":"learner","groupId":"{GROUP}","gradingCallbackRequired":true}}"#
    );
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header("user-session", session)
        .header("cookie", "other=1; authentication=jwt-abc");
    if body.is_some() {
        req = req.header("content-type", "application/json");
    }
    let body = body.map_or_else(Body::empty, |b| Body::from(b.to_string()));
    let response = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

/// A PATCH with a body sent as given, without a length header.
async fn call_raw(app: &Router, uri: &str, body: String) -> (StatusCode, String) {
    let session = format!(
        r#"{{"userId":"{USER}","role":"learner","groupId":"{GROUP}","gradingCallbackRequired":true}}"#
    );
    let req = Request::builder()
        .method("PATCH")
        .uri(uri)
        .header("user-session", session)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap();
    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

fn enabled() -> Option<String> {
    let url = std::env::var("DATABASE_URL")
        .ok()
        .filter(|v| !v.is_empty())?;
    (std::env::var("MARK_LEARNER_FIXTURE_DB").as_deref() == Ok("1")).then_some(url)
}

#[tokio::test]
async fn submit_routes_end_to_end() {
    let Some(url) = enabled() else {
        eprintln!("MARK_LEARNER_FIXTURE_DB=1 and DATABASE_URL not set; skipping");
        return;
    };
    let leaked: &'static str = Box::leak(url.into_boxed_str());
    let config =
        Config::load(Role::Api, &HashMap::from([("DATABASE_URL", leaked)])).expect("config");
    let pool = db::pool(&config).expect("pool");
    let f = setup(&pool).await;

    let mocks = Mocks::default();
    let (internal_url, gateway_url) = start_mocks(mocks.clone()).await;
    let app = Router::new().nest(
        "/api/v2",
        router(LearnerState {
            pool: pool.clone(),
            accept_operations: true,
            submit: SubmitSettings {
                internal: Some(InternalApi::new(&internal_url, "secret".to_owned()).unwrap()),
                lti: LtiGateway::with_timeout(Some(gateway_url), LTI_TIMEOUT).unwrap(),
                learner_buckets: Arc::new(vec!["learner".to_owned()]),
            },
        }),
    );
    let a = f.assignment;
    let base = |t: i32| format!("/api/v2/assignments/{a}/attempts/{t}");

    // Inline submit: the single choice in its French rendering, a partly
    // right multiple choice, a wrong true/false; all base64-encoded.
    let submit = json!({
        "submitted": true,
        "language": "en",
        "responsesForQuestions": [
            {"id": f.q_single, "learnerTextResponse": "", "learnerUrlResponse": "", "learnerChoices": [b64("Paris (fr)")],
             "learnerAnswerChoice": null, "learnerFileResponse": [], "learnerPresentationResponse": null},
            {"id": f.q_multi, "learnerChoices": [b64("Red"), b64("Blue")]},
            {"id": f.q_tf, "learnerAnswerChoice": true}
        ]
    });
    let (status, body) = call(&app, "PATCH", &base(f.inline_attempt), Some(submit.clone())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let result: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(result["grade"], json!(0.6), "{body}");
    assert_eq!(result["totalPointsEarned"], 3);
    assert_eq!(result["totalPossiblePoints"], 5);
    assert_eq!(result["correctAnswerVisibility"], "ALWAYS");
    let feedbacks = result["feedbacksForQuestions"].as_array().unwrap();
    assert_eq!(feedbacks.len(), 3);
    assert_eq!(feedbacks[0]["questionId"], f.q_single);
    assert_eq!(feedbacks[0]["totalPoints"], 2);
    assert_eq!(
        feedbacks[0]["feedback"][0]["feedback"],
        "**Correct selection:** Paris (fr) (+2 points)"
    );
    assert_eq!(
        feedbacks[1]["feedback"][0]["feedback"],
        "**Correct selection:** Red (+1 points).\n**Incorrect selection:** Blue (-1 points).\nThe correct option(s) were: **Red, Green**."
    );
    assert_eq!(
        feedbacks[2]["feedback"][0]["feedback"],
        "Incorrect. The correct answer is False."
    );
    assert_eq!(
        mocks.active_lookups.load(Ordering::SeqCst),
        0,
        "inline submits skip the job lookup"
    );

    // What was stored.
    let t = f.inline_attempt;
    let stored = row_json(
        &pool,
        &format!(
            r#"SELECT json_agg(json_build_object('lr', "learnerResponse", 'points', points, 'feedback', feedback, 'metadata', metadata) ORDER BY id)
               FROM "QuestionResponse" WHERE "assignmentAttemptId" = {t}"#
        ),
    )
    .await;
    assert_eq!(stored[0]["lr"], json!("[\"Paris (fr)\"]"));
    assert!(
        stored[0]["metadata"].is_string(),
        "metadata is a JSON string: {stored}"
    );
    assert_eq!(stored[2]["lr"], json!("true"));
    let attempt = row_json(
        &pool,
        &format!(r#"SELECT row_to_json(t) FROM (SELECT submitted, grade, "preferredLanguage", "expiresAt" IS NOT NULL AS expires FROM "AssignmentAttempt" WHERE id = {t}) t"#),
    )
    .await;
    assert_eq!(
        attempt,
        json!({"submitted": true, "grade": 0.6, "preferredLanguage": "en", "expires": true})
    );
    // No progress row is created for an inline grade.
    assert_eq!(
        scalar_i32(
            &pool,
            &format!(r#"SELECT count(*)::int FROM "GradingProgress" WHERE "attemptId" = {t}"#)
        )
        .await,
        0
    );

    // The first passback failed and is scheduled for the legacy retry job.
    {
        let calls = mocks.lti_calls.lock().unwrap();
        assert_eq!(
            calls[0],
            ("authentication=jwt-abc".to_owned(), json!({"score": 0.6}))
        );
    }
    let sync = row_json(
        &pool,
        &format!(r#"SELECT row_to_json(s) FROM (SELECT status, "retryCount", "lastError", "authCookie", "nextRetryAt" IS NOT NULL AS next, "learnerNotified", "errorHistory" FROM "LtiGradeSync" WHERE "attemptId" = {t}) s"#),
    )
    .await;
    assert_eq!(sync["status"], "SCHEDULED");
    assert_eq!(sync["retryCount"], 1);
    assert_eq!(sync["lastError"], "LMS unavailable");
    assert_eq!(sync["authCookie"], "jwt-abc");
    assert_eq!(sync["next"], true);
    assert_eq!(sync["learnerNotified"], true);
    assert_eq!(sync["errorHistory"][0]["httpStatus"], 502);

    // Side routes.
    let (status, body) = call(&app, "GET", &format!("{}/grade-sync-status", base(t)), None).await;
    assert_eq!(status, StatusCode::OK);
    let sync: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(sync["status"], "SCHEDULED");
    assert_eq!(sync["grade"], json!(0.6));
    assert_eq!(sync["errorLogs"].as_array().unwrap().len(), 1);
    assert_eq!(sync["errorLogs"][0]["httpStatus"], 502);
    assert!(!body.contains("jwt-abc"));

    let (status, body) = call(&app, "GET", &format!("{}/submission-status", base(t)), None).await;
    assert_eq!(status, StatusCode::OK);
    let s: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        (
            s["submitted"].clone(),
            s["acceptingSubmissions"].clone(),
            s["closedAtTimeLimit"].clone()
        ),
        (json!(true), json!(false), json!(false))
    );

    let (status, body) = call(
        &app,
        "POST",
        &format!("{}/notify", base(t)),
        Some(json!({"email": "x@evil.test"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        body,
        format!(
            r#"{{"success":true,"message":"You will receive an email at {USER} when grading is complete"}}"#
        )
    );
    let notify = row_json(
        &pool,
        &format!(r#"SELECT row_to_json(p) FROM (SELECT "notifyOnComplete", "notificationEmail", status FROM "GradingProgress" WHERE "attemptId" = {t}) p"#),
    )
    .await;
    assert_eq!(
        notify,
        json!({"notifyOnComplete": true, "notificationEmail": USER, "status": "PENDING"})
    );

    let (status, body) = call(&app, "GET", &format!("{}/completed", base(t)), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let completed: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(completed["grade"], json!(0.6));
    assert_eq!(completed["totalPossiblePoints"], 5);
    assert_eq!(completed["preferredLanguage"], "en");
    let questions = completed["questions"].as_array().unwrap();
    assert_eq!(questions.len(), 3);
    assert_eq!(
        questions[0]["response"]["learnerResponse"],
        json!(["Paris (fr)"])
    );
    assert_eq!(
        questions[0]["choices"][0],
        json!({"id": 1, "choice": "Paris", "isCorrect": true, "feedback": null})
    );
    assert_eq!(
        questions[1]["response"]["feedback"][0]["feedback"],
        "**Correct selection:** Red (+1 points).\n**Incorrect selection:** Blue (-1 points).\nThe correct option(s) were: **Red, Green**."
    );
    assert_eq!(questions[2]["response"]["learnerResponse"], json!(true));

    // A second submit of the same attempt is refused.
    let (status, body) = call(&app, "PATCH", &base(t), Some(submit.clone())).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        body,
        format!(
            r#"{{"statusCode":409,"error":"Conflict","code":"ATTEMPT_ALREADY_SUBMITTED","message":"This attempt has already been submitted.","attemptId":{t}}}"#
        )
    );

    // A late submit with nothing in flight closes the attempt at zero.
    let late = f.late_attempt;
    let (status, body) = call(&app, "PATCH", &base(late), Some(submit.clone())).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(body.contains("ATTEMPT_CLOSED_AT_TIME_LIMIT"), "{body}");
    assert_eq!(mocks.active_lookups.load(Ordering::SeqCst), 1);
    let closed = row_json(
        &pool,
        &format!(r#"SELECT row_to_json(t) FROM (SELECT submitted, grade, comments FROM "AssignmentAttempt" WHERE id = {late}) t"#),
    )
    .await;
    assert_eq!(closed["submitted"], true);
    assert_eq!(closed["grade"], json!(0));
    assert_eq!(
        closed["comments"],
        mark_learner::deadline::EXPIRED_ATTEMPT_COMMENT
    );
    let (_, body) = call(
        &app,
        "GET",
        &format!("{}/submission-status", base(late)),
        None,
    )
    .await;
    assert!(body.contains(r#""closedAtTimeLimit":true"#), "{body}");

    // A pinned version with a TEXT question is queued with the decoded payload.
    let queued = f.queued_attempt;
    let (status, body) = call(
        &app,
        "PATCH",
        &base(queued),
        Some(
            json!({"submitted": true, "language": "fr", "responsesForQuestions": [
                {"id": f.q_single, "learnerChoices": [b64("Paris")], "extra": "stripped"}
            ]}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        r#"{"gradingJobId":"11111111-2222-3333-4444-555555555555","message":"Grading job created. Use the SSE endpoint to track progress."}"#
    );
    {
        let enqueued = mocks.enqueued.lock().unwrap();
        assert_eq!(enqueued.len(), 1);
        let sent = &enqueued[0];
        assert_eq!(sent["tier"], "standard");
        assert_eq!(sent["authCookie"], "jwt-abc");
        assert_eq!(sent["gradingCallbackRequired"], true);
        assert_eq!(
            sent["updateDto"],
            json!({"submitted": true, "responsesForQuestions": [{"id": f.q_single, "learnerChoices": ["Paris"]}], "language": "fr"})
        );
    }
    let still_open = row_json(
        &pool,
        &format!(r#"SELECT to_json(submitted) FROM "AssignmentAttempt" WHERE id = {queued}"#),
    )
    .await;
    assert_eq!(still_open, json!(false));

    // Payload refusals come back before anything is written.
    let second = f.second_inline_attempt;
    let (status, body) = call(
        &app,
        "PATCH",
        &base(second),
        Some(json!({"submitted": true, "responsesForQuestions": [{"id": 999_999}]})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        format!(
            r#"{{"message":"Invalid question responses for attempt {second}: unserved question IDs [999999]","error":"Bad Request","statusCode":400}}"#
        )
    );
    let (status, body) = call(
        &app,
        "PATCH",
        &base(second),
        Some(json!({"submitted": true, "responsesForQuestions": [{"id": f.q_single, "learnerChoices": [b64("Paris"), b64("Lyon")]}]})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        r#"{"message":"Failed to process question response: tooManyChoicesSelected","error":"Bad Request","statusCode":400}"#
    );

    // Bodies: not JSON, too large, and junk the reader skips without
    // building it.
    let (status, body) = call_raw(&app, &base(second), "{not json".into()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        r#"{"message":"Request body is not valid JSON","error":"Bad Request","statusCode":400}"#
    );
    let (status, body) = call_raw(&app, &base(second), " ".repeat(17 * 1024 * 1024)).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        body,
        r#"{"message":"request entity too large","error":"Payload Too Large","statusCode":413}"#
    );
    let junk = "{\"a\":1},".repeat(256 * 1024);
    let raw = format!(
        r#"{{"submitted":true,"responsesForQuestions":[{{"id":{},"learnerFileResponse":[{{"filename":"a","key":"k","bucket":"learner","x":[{junk}0]}}]}}]}}"#,
        f.q_single
    );
    assert!(raw.len() > 2 * 1024 * 1024);
    let started = std::time::Instant::now();
    let (status, body) = call_raw(&app, &base(second), raw).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        r#"{"message":["responsesForQuestions.0.learnerFileResponse must be a list of uploaded file references"],"error":"Bad Request","statusCode":400}"#
    );
    let item = format!("{{\"id\":{}}},", f.q_single);
    let items = item.repeat(3 * 1024 * 1024 / item.len());
    let raw = format!(r#"{{"submitted":true,"responsesForQuestions":[{items}{{"id":1}}]}}"#);
    assert!(raw.len() > 2 * 1024 * 1024);
    let (status, body) = call_raw(&app, &base(second), raw).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        r#"{"message":["responsesForQuestions must contain no more than 200 elements"],"error":"Bad Request","statusCode":400}"#
    );
    assert!(
        started.elapsed() < std::time::Duration::from_secs(10),
        "junk bodies took {:?}",
        started.elapsed()
    );

    // A progress row that exists is completed by the inline commit.
    let (status, _) = call(&app, "POST", &format!("{}/notify", base(second)), None).await;
    assert_eq!(status, StatusCode::CREATED);

    // An all-correct inline submit; the passback now succeeds with the best grade.
    let (status, body) = call(
        &app,
        "PATCH",
        &base(second),
        Some(json!({"submitted": true, "responsesForQuestions": [
            {"id": f.q_single, "learnerChoices": [b64("Paris")]},
            {"id": f.q_multi, "learnerChoices": [b64("Green"), b64("Red")]},
            {"id": f.q_tf, "learnerAnswerChoice": false}
        ]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let result: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(result["grade"], 1);
    assert_eq!(result["passed"], Value::Null);
    let sync = row_json(
        &pool,
        &format!(r#"SELECT row_to_json(s) FROM (SELECT status, grade, "completedAt" IS NOT NULL AS done FROM "LtiGradeSync" WHERE "attemptId" = {second}) s"#),
    )
    .await;
    assert_eq!(sync, json!({"status": "SUCCESS", "grade": 1, "done": true}));
    let progress = row_json(
        &pool,
        &format!(r#"SELECT row_to_json(p) FROM (SELECT status, progress, "currentStage", "completedAt" IS NOT NULL AS done FROM "GradingProgress" WHERE "attemptId" = {second}) p"#),
    )
    .await;
    assert_eq!(
        progress,
        json!({"status": "COMPLETED", "progress": 100, "currentStage": "Grading complete!", "done": true})
    );

    // A passback that times out leaves the row IN_PROGRESS for the stale-row
    // recovery: no error, no retry schedule, no notice.
    let timeout = f.timeout_attempt;
    let (status, body) = call(&app, "PATCH", &base(timeout), Some(submit.clone())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let sync = row_json(
        &pool,
        &format!(r#"SELECT row_to_json(s) FROM (SELECT id, status, "retryCount", "lastError", "nextRetryAt", "learnerNotified" FROM "LtiGradeSync" WHERE "attemptId" = {timeout}) s"#),
    )
    .await;
    assert_eq!(sync["status"], "IN_PROGRESS");
    assert_eq!(sync["retryCount"], 0);
    assert_eq!(sync["lastError"], Value::Null);
    assert_eq!(sync["nextRetryAt"], Value::Null);
    assert_eq!(sync["learnerNotified"], false);
    let sync_id = sync["id"].as_i64().unwrap();
    assert_eq!(
        scalar_i32(
            &pool,
            &format!(r#"SELECT count(*)::int FROM "LtiSyncErrorLog" WHERE "syncId" = {sync_id}"#)
        )
        .await,
        0
    );
    assert_eq!(
        scalar_i32(
            &pool,
            &format!(r#"SELECT count(*)::int FROM "UserNotification" WHERE "userId" = '{USER}'"#)
        )
        .await,
        1,
        "only the first (failed) passback left a notice"
    );

    // A served question missing from the pinned version is graded from its
    // live row; a TEXT one sends the attempt to the queue, not to a 400.
    let fallback = f.fallback_attempt;
    let fallback_submit = json!({"submitted": true, "responsesForQuestions": [
        {"id": f.q_single, "learnerChoices": [b64("Paris")]}
    ]});
    // The queue's 400 reaches the learner as sent.
    let mut drift = fallback_submit.clone();
    drift["language"] = json!("de");
    let (status, body) = call(&app, "PATCH", &base(fallback), Some(drift)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        body,
        r#"{"message":["language must be one of the following values: en"],"error":"Bad Request","statusCode":400}"#
    );
    let (status, body) = call(&app, "PATCH", &base(fallback), Some(fallback_submit)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("gradingJobId"), "{body}");
    {
        let enqueued = mocks.enqueued.lock().unwrap();
        assert_eq!(enqueued.len(), 3);
        assert_eq!(enqueued[2]["attemptId"], fallback);
        assert_eq!(enqueued[2]["tier"], "standard");
    }
    assert_eq!(
        row_json(
            &pool,
            &format!(r#"SELECT to_json(submitted) FROM "AssignmentAttempt" WHERE id = {fallback}"#),
        )
        .await,
        json!(false)
    );

    cleanup(&pool).await;
}
