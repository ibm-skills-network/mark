//! Grade passback for LTI launches (`lti-grade-sync.service.ts`
//! `createAndSync`): record the sync, PUT the score to the LTI gateway, and
//! on a failed answer schedule the row for the legacy retry job exactly as
//! its own failure handler does. A PUT that times out may still have
//! reached the LMS, so its row is left `IN_PROGRESS` without an error or a
//! notice, for the legacy stale-row recovery to resend. Never fails the
//! submit; never logs the cookie.

use std::time::Duration;

use chrono::NaiveDateTime;
use serde_json::{json, Value};
use sqlx::PgPool;
use tracing::{error, info, warn};

use crate::js;
use crate::params::{iso, now_millis};
use crate::store;

const TIMEOUT: Duration = Duration::from_secs(10);
/// First retry delay of the legacy schedule (5m, 15m, 30m, ...).
const FIRST_RETRY_MINUTES: i64 = 5;
const RETRY_TITLE: &str = "Retrying grade sync";
const RETRY_MESSAGE: &str = "We encountered an issue syncing your grade to your course platform. We'll automatically retry in 5 minutes. You don't need to do anything.";

/// The LTI gateway endpoint grades are PUT to.
#[derive(Clone, Default)]
pub struct LtiGateway {
    url: Option<String>,
    http: Option<reqwest::Client>,
    timeout: Duration,
}

impl std::fmt::Debug for LtiGateway {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LtiGateway")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

/// How a PUT ended when it did not succeed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendFailure {
    pub message: String,
    pub http_status: Option<i32>,
    pub response_body: Option<String>,
    /// No answer within the timeout: the LMS may have the grade already.
    pub timed_out: bool,
}

impl LtiGateway {
    pub fn new(url: Option<String>) -> Result<Self, reqwest::Error> {
        Self::with_timeout(url, TIMEOUT)
    }

    /// As `new`, with another request timeout.
    pub fn with_timeout(url: Option<String>, timeout: Duration) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .connect_timeout(timeout)
            .build()?;
        Ok(Self {
            url,
            http: Some(http),
            timeout,
        })
    }

    pub fn url(&self) -> Option<&str> {
        self.url.as_deref()
    }

    /// `PUT <url> {score}` with the learner's session cookie. `Ok` only for 200.
    pub async fn send(&self, score: f64, auth_cookie: &str) -> Result<(), SendFailure> {
        let (Some(url), Some(http)) = (self.url.as_deref(), self.http.as_ref()) else {
            return Err(SendFailure {
                message: "GRADING_LTI_GATEWAY_URL is not set".to_owned(),
                http_status: None,
                response_body: None,
                timed_out: false,
            });
        };
        let response = http
            .put(url)
            .header("Cookie", format!("authentication={auth_cookie}"))
            .json(&json!({ "score": js::num(score) }))
            .send()
            .await
            .map_err(|e| SendFailure {
                timed_out: e.is_timeout(),
                message: if e.is_timeout() {
                    format!("timeout of {}ms exceeded", self.timeout.as_millis())
                } else {
                    // The URL is ours; the error text never carries the cookie.
                    e.without_url().to_string()
                },
                http_status: None,
                response_body: None,
            })?;
        let status = response.status();
        if status.as_u16() == 200 {
            return Ok(());
        }
        if status.is_success() {
            return Err(SendFailure {
                message: format!("Unexpected response status: {}", status.as_u16()),
                http_status: None,
                response_body: None,
                timed_out: false,
            });
        }
        let text = response.text().await.unwrap_or_default();
        let parsed: Option<Value> = serde_json::from_str(&text).ok();
        let message = parsed
            .as_ref()
            .and_then(|v| v.get("message"))
            .and_then(Value::as_str)
            .map_or_else(
                || format!("Request failed with status code {}", status.as_u16()),
                str::to_owned,
            );
        let response_body = match parsed {
            Some(Value::String(s)) => Some(s),
            Some(other) => Some(other.to_string()),
            None => Some(text),
        };
        Err(SendFailure {
            message,
            http_status: Some(i32::from(status.as_u16())),
            response_body,
            timed_out: false,
        })
    }
}

/// What the submit hands to the passback.
#[derive(Debug, Clone)]
pub struct Passback<'a> {
    pub attempt_id: i32,
    pub assignment_id: i32,
    pub user_id: &'a str,
    pub auth_cookie: &'a str,
}

/// The score sent: the best grade of the learner on this assignment,
/// including the one just committed.
pub fn passback_score(grades: &[Option<f64>], grade: f64) -> f64 {
    let mut best = 0.0_f64;
    for g in grades.iter().flatten() {
        if *g > best {
            best = *g;
        }
    }
    if grade > best {
        best = grade;
    }
    best
}

/// Record and send the grade; on a failed answer leave the row SCHEDULED
/// for the legacy retry job, on a timeout leave it `IN_PROGRESS`. Errors are
/// logged, never returned.
pub async fn sync(pool: &PgPool, gateway: &LtiGateway, passback: Passback<'_>, grade: f64) {
    if let Err(err) = sync_inner(pool, gateway, &passback, grade).await {
        error!(
            assignment_id = passback.assignment_id,
            attempt_id = passback.attempt_id,
            user_id = passback.user_id,
            error = %err,
            "lti grade sync could not be recorded"
        );
    }
}

async fn sync_inner(
    pool: &PgPool,
    gateway: &LtiGateway,
    p: &Passback<'_>,
    grade: f64,
) -> Result<(), sqlx::Error> {
    let started = now_millis();
    let mut tx = store::begin_write(pool).await?;
    let grades = store::attempt_grades(&mut tx, p.assignment_id, p.user_id).await?;
    let score = passback_score(&grades, grade);
    let sync_id = store::insert_lti_sync(
        &mut tx,
        &store::LtiSyncInsert {
            attempt_id: p.attempt_id,
            user_id: p.user_id,
            assignment_id: p.assignment_id,
            grade: score,
            auth_cookie: p.auth_cookie,
            gateway_url: gateway.url(),
            now: started,
        },
    )
    .await?;
    tx.commit().await?;
    info!(
        assignment_id = p.assignment_id,
        attempt_id = p.attempt_id,
        user_id = p.user_id,
        sync_id,
        score,
        "lti grade sync started"
    );

    let outcome = gateway.send(score, p.auth_cookie).await;
    let now = now_millis();
    match outcome {
        Err(failure) if failure.timed_out => {
            // The LMS may have taken the grade; scheduling a retry with an
            // error and a "retrying" notice would be wrong if it did.
            warn!(
                assignment_id = p.assignment_id,
                attempt_id = p.attempt_id,
                sync_id,
                outcome = "timed_out",
                "lti grade sync timed out; row left IN_PROGRESS for stale-row recovery"
            );
        }
        Ok(()) => {
            let mut tx = store::begin_write(pool).await?;
            store::mark_lti_sync_success(&mut tx, sync_id, now).await?;
            tx.commit().await?;
            info!(
                assignment_id = p.assignment_id,
                attempt_id = p.attempt_id,
                sync_id,
                outcome = "success",
                "lti grade sync finished"
            );
        }
        Err(failure) => {
            let mut tx = store::begin_write(pool).await?;
            let next_retry_at = schedule_retry(&mut tx, sync_id, p, score, &failure, now).await?;
            tx.commit().await?;
            notify_learner(pool, sync_id, p, score, next_retry_at, now).await;
            warn!(
                assignment_id = p.assignment_id,
                attempt_id = p.attempt_id,
                sync_id,
                http_status = failure.http_status,
                error = %failure.message,
                outcome = "scheduled",
                "lti grade sync failed; retry scheduled"
            );
        }
    }
    Ok(())
}

/// The legacy failure handler for a first failure: an error log row and the
/// row SCHEDULED at the first retry delay. Returns that retry time.
async fn schedule_retry(
    conn: &mut sqlx::PgConnection,
    sync_id: i32,
    p: &Passback<'_>,
    score: f64,
    failure: &SendFailure,
    now: NaiveDateTime,
) -> Result<NaiveDateTime, sqlx::Error> {
    let timestamp = iso(now);
    store::insert_lti_error_log(
        &mut *conn,
        &store::LtiErrorLogInsert {
            sync_id,
            attempt_number: 1,
            error_message: &failure.message,
            http_status: failure.http_status,
            response_body: failure.response_body.as_deref(),
            metadata: json!({
                "attemptId": p.attempt_id,
                "grade": js::num(score),
                "timestamp": timestamp,
            }),
            now,
        },
    )
    .await?;
    let mut entry = serde_json::Map::new();
    entry.insert("attempt".into(), json!(1));
    entry.insert("error".into(), Value::from(failure.message.clone()));
    entry.insert("timestamp".into(), Value::from(timestamp));
    if let Some(status) = failure.http_status {
        entry.insert("httpStatus".into(), json!(status));
    }
    let next_retry_at = now + chrono::Duration::minutes(FIRST_RETRY_MINUTES);
    store::schedule_lti_sync_retry(
        &mut *conn,
        sync_id,
        1,
        &failure.message,
        &Value::Array(vec![Value::Object(entry)]),
        next_retry_at,
        now,
    )
    .await?;
    Ok(next_retry_at)
}

/// The learner's in-app "retrying" notice. Best effort, as in the legacy
/// handler: a failure here is logged and the scheduled retry stands.
async fn notify_learner(
    pool: &PgPool,
    sync_id: i32,
    p: &Passback<'_>,
    score: f64,
    next_retry_at: NaiveDateTime,
    now: NaiveDateTime,
) {
    let metadata = json!({
        "syncId": sync_id,
        "attemptId": p.attempt_id,
        "assignmentId": p.assignment_id,
        "grade": js::num(score),
        "retryCount": 0,
        "nextRetryAt": iso(next_retry_at),
    });
    let result = async {
        let mut tx = store::begin_write(pool).await?;
        store::insert_grade_sync_notification(
            &mut tx,
            p.user_id,
            RETRY_TITLE,
            RETRY_MESSAGE,
            &metadata.to_string(),
            now,
        )
        .await?;
        store::mark_lti_learner_notified(&mut tx, sync_id, now).await?;
        tx.commit().await
    }
    .await;
    match result {
        Ok(()) => info!(
            attempt_id = p.attempt_id,
            sync_id, "lti sync failure notice recorded (no email is sent from this service)"
        ),
        Err(err) => error!(
            attempt_id = p.attempt_id,
            sync_id,
            error = %err,
            "could not record the lti sync failure notice"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[allow(clippy::float_cmp)]
    fn score_is_the_best_grade() {
        assert_eq!(passback_score(&[Some(0.4), None, Some(0.9)], 0.5), 0.9);
        assert_eq!(passback_score(&[Some(0.4)], 0.5), 0.5);
        assert_eq!(passback_score(&[], 0.0), 0.0);
    }
}
