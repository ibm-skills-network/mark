//! The submit's side routes: submission status, "email me when graded", and
//! the LTI grade passback status.

use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::{Map, Value};
use tracing::info;

use crate::access::{self, Intent};
use crate::deadline;
use crate::error::ApiError;
use crate::js;
use crate::params::{iso, iso_opt, now_millis, whole_f64};
use crate::principal::{Role, UserSession};
use crate::store::{self, LtiErrorLogRow, LtiSyncRow};
use crate::LearnerState;

fn raw_pair(path: Result<Path<(String, String)>, PathRejection>) -> (String, String) {
    path.map(|Path(p)| p).unwrap_or_default()
}

fn ids(
    session: &UserSession,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<(i32, i32), ApiError> {
    let (raw_assignment, raw_attempt) = raw_pair(path);
    Ok((
        access::attempt_route_assignment_id(&raw_assignment, session)?,
        access::attempt_route_attempt_id(&raw_attempt, session)?,
    ))
}

// ---------------------------------------------------------------- submission status

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionStatus {
    pub id: i32,
    pub submitted: bool,
    pub closed_at_time_limit: bool,
    pub accepting_submissions: bool,
    pub expires_at: Option<String>,
    pub server_now: String,
}

pub async fn submission_status(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<Json<SubmissionStatus>, ApiError> {
    session.require_role(&[Role::Learner])?;
    let (assignment_id, attempt_id) = ids(&session, path)?;
    let mut tx = store::begin_read(&state.pool).await?;
    let attempt = access::attempt_item(
        &mut tx,
        &session,
        Role::Learner,
        assignment_id,
        attempt_id,
        Intent::Read,
    )
    .await?;
    tx.commit().await?;
    let now = now_millis();
    let status = SubmissionStatus {
        id: attempt.id,
        submitted: attempt.submitted,
        closed_at_time_limit: attempt.submitted
            && deadline::closed_at_time_limit(attempt.comments.as_deref()),
        accepting_submissions: !attempt.submitted && !deadline::past_grace(attempt.expires_at, now),
        expires_at: iso_opt(attempt.expires_at),
        server_now: iso(now),
    };
    info!(
        assignment_id,
        attempt_id,
        user_id = session.log_user(),
        submitted = status.submitted,
        accepting_submissions = status.accepting_submissions,
        "submission status served"
    );
    Ok(Json(status))
}

// ---------------------------------------------------------------- notify

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NotifySubscribed {
    pub success: bool,
    pub message: String,
}

/// The body is ignored: the address is the session's own.
pub async fn notify(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<(StatusCode, Json<NotifySubscribed>), ApiError> {
    session.require_role(&[Role::Learner])?;
    let (assignment_id, attempt_id) = ids(&session, path)?;
    let mut tx = store::begin_write(&state.pool).await?;
    access::attempt_item(
        &mut tx,
        &session,
        Role::Learner,
        assignment_id,
        attempt_id,
        Intent::Write,
    )
    .await?;
    // attempt_item refuses learner sessions without a user id.
    let email = session.non_empty_user_id().unwrap_or_default().to_owned();
    store::enable_grading_notification(&mut tx, attempt_id, &email, now_millis()).await?;
    tx.commit().await?;
    info!(
        assignment_id,
        attempt_id,
        user_id = %email,
        outcome = "subscribed",
        "grading notification enabled"
    );
    Ok((
        StatusCode::CREATED,
        Json(NotifySubscribed {
            success: true,
            message: format!("You will receive an email at {email} when grading is complete"),
        }),
    ))
}

// ---------------------------------------------------------------- grade sync status

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeSyncStatus {
    pub id: i32,
    pub status: String,
    #[serde(serialize_with = "whole_f64")]
    pub grade: Option<f64>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub last_error: Option<String>,
    pub next_retry_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub error_logs: Vec<Value>,
    pub can_retry: bool,
}

/// An error log row with every column, in the model's order.
fn error_log(row: &LtiErrorLogRow) -> Value {
    let mut map = Map::new();
    map.insert("id".into(), Value::from(row.id));
    map.insert("syncId".into(), Value::from(row.sync_id));
    map.insert("attemptNumber".into(), Value::from(row.attempt_number));
    map.insert(
        "errorMessage".into(),
        Value::from(row.error_message.clone()),
    );
    map.insert(
        "errorStack".into(),
        row.error_stack.clone().map_or(Value::Null, Value::from),
    );
    map.insert(
        "httpStatus".into(),
        row.http_status.map_or(Value::Null, Value::from),
    );
    map.insert(
        "responseBody".into(),
        row.response_body.clone().map_or(Value::Null, Value::from),
    );
    map.insert("timestamp".into(), Value::from(iso(row.timestamp)));
    map.insert(
        "metadata".into(),
        row.metadata.clone().map_or(Value::Null, js::normalize),
    );
    Value::Object(map)
}

pub fn grade_sync_status_of(sync: &LtiSyncRow, logs: &[LtiErrorLogRow]) -> GradeSyncStatus {
    GradeSyncStatus {
        id: sync.id,
        status: sync.status.clone(),
        grade: Some(sync.grade),
        retry_count: sync.retry_count,
        max_retries: sync.max_retries,
        last_error: sync.last_error.clone(),
        next_retry_at: iso_opt(sync.next_retry_at),
        completed_at: iso_opt(sync.completed_at),
        created_at: iso(sync.created_at),
        error_logs: logs.iter().map(error_log).collect(),
        can_retry: sync.retry_count < sync.max_retries,
    }
}

/// The newest sync with its five newest error logs, or an empty 200 body.
pub async fn grade_sync_status(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<Response, ApiError> {
    let role = session.require_role(&[Role::Learner, Role::Author])?;
    let (assignment_id, attempt_id) = ids(&session, path)?;
    let mut tx = store::begin_read(&state.pool).await?;
    access::attempt_item(
        &mut tx,
        &session,
        role,
        assignment_id,
        attempt_id,
        Intent::Read,
    )
    .await?;
    let sync = store::latest_lti_sync(&mut tx, attempt_id).await?;
    let logs = match &sync {
        Some(s) => store::lti_error_logs(&mut tx, s.id).await?,
        None => Vec::new(),
    };
    tx.commit().await?;
    info!(
        assignment_id,
        attempt_id,
        user_id = session.log_user(),
        found = sync.is_some(),
        "grade sync status served"
    );
    Ok(match sync {
        Some(s) => Json(grade_sync_status_of(&s, &logs)).into_response(),
        None => StatusCode::OK.into_response(),
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn at(h: u32) -> chrono::NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 10, 24)
            .unwrap()
            .and_hms_milli_opt(h, 0, 0, 5)
            .unwrap()
    }

    #[test]
    fn grade_sync_shape() {
        let sync = LtiSyncRow {
            id: 4,
            status: "SCHEDULED".into(),
            grade: 1.0,
            retry_count: 1,
            max_retries: 5,
            last_error: Some("Request failed with status code 500".into()),
            next_retry_at: Some(at(11)),
            completed_at: None,
            created_at: at(10),
        };
        let log = LtiErrorLogRow {
            id: 9,
            sync_id: 4,
            attempt_number: 1,
            error_message: "boom".into(),
            error_stack: None,
            http_status: Some(500),
            response_body: Some("{}".into()),
            timestamp: at(10),
            metadata: Some(json!({"grade": 1.0, "attemptId": 7})),
        };
        assert_eq!(
            serde_json::to_string(&grade_sync_status_of(&sync, &[log])).unwrap(),
            concat!(
                r#"{"id":4,"status":"SCHEDULED","grade":1,"retryCount":1,"maxRetries":5,"#,
                r#""lastError":"Request failed with status code 500","nextRetryAt":"2026-10-24T11:00:00.005Z","#,
                r#""completedAt":null,"createdAt":"2026-10-24T10:00:00.005Z","errorLogs":[{"id":9,"syncId":4,"#,
                r#""attemptNumber":1,"errorMessage":"boom","errorStack":null,"httpStatus":500,"responseBody":"{}","#,
                r#""timestamp":"2026-10-24T10:00:00.005Z","metadata":{"grade":1,"attemptId":7}}],"canRetry":true}"#
            )
        );
    }

    #[test]
    fn notify_and_status_shapes() {
        let body = NotifySubscribed {
            success: true,
            message: "You will receive an email at a@b.c when grading is complete".into(),
        };
        assert_eq!(
            serde_json::to_string(&body).unwrap(),
            r#"{"success":true,"message":"You will receive an email at a@b.c when grading is complete"}"#
        );
        let status = SubmissionStatus {
            id: 1,
            submitted: false,
            closed_at_time_limit: false,
            accepting_submissions: true,
            expires_at: None,
            server_now: "2026-10-24T10:00:00.000Z".into(),
        };
        assert_eq!(
            serde_json::to_string(&status).unwrap(),
            r#"{"id":1,"submitted":false,"closedAtTimeLimit":false,"acceptingSubmissions":true,"expiresAt":null,"serverNow":"2026-10-24T10:00:00.000Z"}"#
        );
    }
}
