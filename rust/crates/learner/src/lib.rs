//! Learner routes (`contracts/learner-load.openapi.yaml`,
//! `contracts/learner-submit.openapi.yaml`): the assignment read, its
//! languages, attempt list / create / read / abandon, and the submit with its
//! results and side routes. Mounted by `mark-api` under `/api/v2`.
//!
//! Reads of the assignment and attempts always mount. Every other route runs
//! only when the deployment's `accept_operations` control is on; otherwise it
//! answers 503 so a dark deployment can never write. The GET assignment
//! group-link self-heal is also a write and is skipped while writes are off.

// Explicit `match` on Option reads better than `if let ... else` where both
// arms log and return.
#![allow(clippy::single_match_else)]

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use sqlx::PgPool;

pub mod access;
pub mod answer_key;
pub mod assignment;
pub mod attempt_view;
pub mod attempts;
pub mod choice_match;
pub mod choices;
pub mod completed;
pub mod deadline;
pub mod error;
pub mod grading;
pub mod internal_client;
pub mod js;
pub mod localization;
pub mod lti;
pub mod params;
pub mod principal;
pub mod question_source;
pub mod shuffle;
pub mod status;
pub mod store;
pub mod submit;
pub mod submit_body;
pub mod submit_request;
pub mod submit_result;
pub mod translation;
pub mod wire;

use error::ApiError;

/// Largest submit body accepted (413 above it). File references carry only
/// a 255-character `content` marker and one text answer at its 200000
/// character cap is under 1 MiB base64-encoded, so this holds a dozen such
/// answers; the parser keeps only the fields it validates, so the cost of a
/// large body is the raw buffer.
pub const SUBMIT_BODY_LIMIT: usize = 16 * 1024 * 1024;

/// Where accepted submits go and what they may reference.
#[derive(Debug, Clone, Default)]
pub struct SubmitSettings {
    /// The legacy API's internal grading endpoints. Without it the submit
    /// route answers 503.
    pub internal: Option<internal_client::InternalApi>,
    /// Grade passback for LTI launches.
    pub lti: lti::LtiGateway,
    /// The buckets learner uploads are written to.
    pub learner_buckets: Arc<Vec<String>>,
}

impl SubmitSettings {
    /// Build the HTTP clients. `internal` is `(base_url, job_queue_secret)`.
    pub fn new(
        internal: Option<(&str, String)>,
        lti_gateway_url: Option<String>,
        learner_buckets: Vec<String>,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self {
            internal: internal
                .map(|(url, secret)| internal_client::InternalApi::new(url, secret))
                .transpose()?,
            lti: lti::LtiGateway::new(lti_gateway_url)?,
            learner_buckets: Arc::new(learner_buckets),
        })
    }
}

/// Shared state for the learner router.
#[derive(Debug, Clone)]
pub struct LearnerState {
    pub pool: PgPool,
    /// `ExecutionControls::accept_operations`.
    pub accept_operations: bool,
    pub submit: SubmitSettings,
}

/// The standard 503 (with `Retry-After: 1`), so a dark deployment looks like
/// a briefly unavailable one to the client.
async fn writes_disabled() -> ApiError {
    tracing::warn!("write refused: accept_operations is off on this backend");
    ApiError::unavailable()
}

/// 503 for a submit while the internal grading API is not configured.
async fn submit_unconfigured() -> ApiError {
    tracing::warn!("submit refused: MARK_INTERNAL_API_URL or JOB_QUEUE_SECRET is not set");
    ApiError::unavailable()
}

/// The learner routes, relative to `/api/v2`.
pub fn router(state: LearnerState) -> Router {
    let on = state.accept_operations;
    let collection = get(attempts::list_attempts);
    let item = get(attempts::get_attempt);
    let (collection, abandon, item) = if on {
        (
            collection.post(attempts::create_attempt),
            post(attempts::abandon_attempt),
            if state.submit.internal.is_some() {
                item.patch(submit::submit_attempt)
            } else {
                item.patch(submit_unconfigured)
            },
        )
    } else {
        (
            collection.post(writes_disabled),
            post(writes_disabled),
            item.patch(writes_disabled),
        )
    };
    let (completed_route, status_route, notify_route, sync_route) = if on {
        (
            get(completed::get_completed),
            get(status::submission_status),
            post(status::notify),
            get(status::grade_sync_status),
        )
    } else {
        (
            get(writes_disabled),
            get(writes_disabled),
            post(writes_disabled),
            get(writes_disabled),
        )
    };
    Router::new()
        .route(
            "/assignments/{assignment_id}",
            get(assignment::get_assignment),
        )
        .route(
            "/assignments/{assignment_id}/languages",
            get(assignment::get_languages),
        )
        .route("/assignments/{assignment_id}/attempts", collection)
        .route(
            "/assignments/{assignment_id}/attempts/{attempt_id}",
            item.layer(DefaultBodyLimit::max(SUBMIT_BODY_LIMIT)),
        )
        .route(
            "/assignments/{assignment_id}/attempts/{attempt_id}/abandon",
            abandon,
        )
        .route(
            "/assignments/{assignment_id}/attempts/{attempt_id}/completed",
            completed_route,
        )
        .route(
            "/assignments/{assignment_id}/attempts/{attempt_id}/submission-status",
            status_route,
        )
        .route(
            "/assignments/{assignment_id}/attempts/{attempt_id}/notify",
            notify_route,
        )
        .route(
            "/assignments/{assignment_id}/attempts/{attempt_id}/grade-sync-status",
            sync_route,
        )
        .with_state(state)
}
