//! The legacy API's internal grading endpoints, which own the Redis job
//! state and the grading queues:
//!
//! * `POST {base}/api/internal/grading/enqueue` queues an accepted submit
//!   (kill switch, job creation with in-flight reuse, enqueue).
//! * `GET {base}/api/internal/grading/active-job` returns the grading job
//!   in flight for `(userId, assignmentId, attemptId)`, if any.
//!
//! Both are authenticated with the shared `x-job-queue-secret` header. The
//! secret and the learner's session cookie are never logged.

use std::time::Duration;

use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tracing::{error, warn};

use crate::error::ApiError;

pub const JOB_QUEUE_SECRET_HEADER: &str = "x-job-queue-secret";
/// A call that times out may still have enqueued the job; the learner's
/// retry then finds it through the in-flight lookup and reuses it.
const TIMEOUT: Duration = Duration::from_secs(15);

/// Client for the internal grading endpoints.
#[derive(Clone)]
pub struct InternalApi {
    base_url: String,
    secret: String,
    http: reqwest::Client,
}

impl std::fmt::Debug for InternalApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InternalApi")
            .field("base_url", &self.base_url)
            .field("secret", &"<redacted>")
            .finish_non_exhaustive()
    }
}

/// The queued tier, which picks the grading queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QueuedTier {
    Standard,
    Heavy,
}

/// `POST /api/internal/grading/enqueue` body. `update_dto` holds only the
/// submit DTO's keys, already base64-decoded and validated.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueRequest {
    pub assignment_id: i32,
    pub attempt_id: i32,
    pub user_id: String,
    pub grading_callback_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_cookie: Option<String>,
    pub submission_received_at: String,
    pub tier: QueuedTier,
    pub update_dto: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnqueueResponse {
    grading_job_id: String,
    #[serde(default)]
    reused: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveJobResponse {
    grading_job_id: Option<String>,
}

/// What the enqueue endpoint answered.
#[derive(Debug, Clone, PartialEq)]
pub enum Enqueued {
    /// A job id, new or the one already in flight.
    Job {
        grading_job_id: String,
        reused: bool,
    },
    /// A 409 (the AI kill switch) or 400 to pass to the learner unchanged.
    Refused { status: StatusCode, body: Value },
}

/// Why a call failed.
#[derive(Debug)]
pub enum CallError {
    /// No answer in time or no connection: safe to retry.
    Unreachable(String),
    /// An answer we cannot use.
    Failed(String),
}

impl From<CallError> for ApiError {
    fn from(err: CallError) -> Self {
        match err {
            CallError::Unreachable(detail) => {
                warn!(error = %detail, "internal grading api unreachable; answering 503");
                ApiError::unavailable()
            }
            CallError::Failed(detail) => ApiError::internal(&detail),
        }
    }
}

fn transport_error(err: &reqwest::Error) -> CallError {
    if err.is_timeout() || err.is_connect() {
        CallError::Unreachable(err.to_string())
    } else {
        CallError::Failed(err.to_string())
    }
}

impl InternalApi {
    pub fn new(base_url: &str, secret: String) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .connect_timeout(TIMEOUT)
            .build()?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            secret,
            http,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api/internal/grading/{path}", self.base_url)
    }

    /// The grading job in flight for this attempt, if any.
    pub async fn active_job(
        &self,
        user_id: &str,
        assignment_id: i32,
        attempt_id: i32,
    ) -> Result<Option<String>, CallError> {
        let response = self
            .http
            .get(self.url("active-job"))
            .header(JOB_QUEUE_SECRET_HEADER, &self.secret)
            .query(&[
                ("userId", user_id.to_owned()),
                ("assignmentId", assignment_id.to_string()),
                ("attemptId", attempt_id.to_string()),
            ])
            .send()
            .await
            .map_err(|e| transport_error(&e))?;
        let status = response.status();
        if status == StatusCode::SERVICE_UNAVAILABLE {
            return Err(CallError::Unreachable("active-job answered 503".to_owned()));
        }
        if status != StatusCode::OK {
            error!(
                assignment_id,
                attempt_id,
                status = status.as_u16(),
                "internal active-job lookup failed"
            );
            return Err(CallError::Failed(format!("active-job answered {status}")));
        }
        let body: ActiveJobResponse = response
            .json()
            .await
            .map_err(|e| CallError::Failed(format!("active-job body: {e}")))?;
        Ok(body.grading_job_id)
    }

    /// Queue an accepted submit for the grading worker.
    pub async fn enqueue(&self, request: &EnqueueRequest) -> Result<Enqueued, CallError> {
        let response = self
            .http
            .post(self.url("enqueue"))
            .header(JOB_QUEUE_SECRET_HEADER, &self.secret)
            .json(request)
            .send()
            .await
            .map_err(|e| transport_error(&e))?;
        let status = response.status();
        if status == StatusCode::CONFLICT || status == StatusCode::BAD_REQUEST {
            let body: Value = response
                .json()
                .await
                .map_err(|e| CallError::Failed(format!("enqueue {status} body: {e}")))?;
            if status == StatusCode::BAD_REQUEST {
                // Rust validated this payload, so a 400 means the two sides
                // disagree about the contract.
                error!(
                    assignment_id = request.assignment_id,
                    attempt_id = request.attempt_id,
                    refusal = body
                        .get("message")
                        .map(serde_json::Value::to_string)
                        .unwrap_or_default(),
                    "contract_drift: internal enqueue refused a validated submit with 400"
                );
            }
            return Ok(Enqueued::Refused { status, body });
        }
        if status == StatusCode::SERVICE_UNAVAILABLE {
            return Err(CallError::Unreachable("enqueue answered 503".to_owned()));
        }
        if status != StatusCode::OK {
            error!(
                assignment_id = request.assignment_id,
                attempt_id = request.attempt_id,
                status = status.as_u16(),
                "internal enqueue failed"
            );
            return Err(CallError::Failed(format!("enqueue answered {status}")));
        }
        let body: EnqueueResponse = response
            .json()
            .await
            .map_err(|e| CallError::Failed(format!("enqueue body: {e}")))?;
        Ok(Enqueued::Job {
            grading_job_id: body.grading_job_id,
            reused: body.reused,
        })
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn debug_redacts_the_secret() {
        let api = InternalApi::new("http://mark-api:3000/", "topsecret".into()).unwrap();
        let text = format!("{api:?}");
        assert!(!text.contains("topsecret"), "{text}");
        assert_eq!(
            api.url("enqueue"),
            "http://mark-api:3000/api/internal/grading/enqueue"
        );
    }

    #[test]
    fn enqueue_body_shape() {
        let mut dto = Map::new();
        dto.insert("submitted".into(), Value::Bool(true));
        let body = EnqueueRequest {
            assignment_id: 1,
            attempt_id: 2,
            user_id: "u@x".into(),
            grading_callback_required: false,
            auth_cookie: None,
            submission_received_at: "2026-10-24T10:00:00.000Z".into(),
            tier: QueuedTier::Heavy,
            update_dto: dto,
        };
        assert_eq!(
            serde_json::to_string(&body).unwrap(),
            r#"{"assignmentId":1,"attemptId":2,"userId":"u@x","gradingCallbackRequired":false,"submissionReceivedAt":"2026-10-24T10:00:00.000Z","tier":"heavy","updateDto":{"submitted":true}}"#
        );
    }
}
