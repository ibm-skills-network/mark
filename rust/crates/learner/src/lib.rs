//! Learner assignment-load routes (`contracts/learner-load.openapi.yaml`):
//! the assignment read, its languages, and attempt list / create / read /
//! abandon. Mounted by `mark-api` under `/api/v2`.
//!
//! Reads always mount. The two POST routes run only when the deployment's
//! `accept_operations` control is on; otherwise they answer 503 so a dark
//! deployment can never write. The GET assignment group-link self-heal is
//! also a write and is skipped while writes are off.

// Explicit `match` on Option reads better than `if let ... else` where both
// arms log and return.
#![allow(clippy::single_match_else)]

use axum::routing::{get, post};
use axum::Router;
use sqlx::PgPool;

pub mod access;
pub mod assignment;
pub mod attempt_view;
pub mod attempts;
pub mod choices;
pub mod error;
pub mod params;
pub mod principal;
pub mod shuffle;
pub mod store;
pub mod translation;

use error::ApiError;

/// Shared state for the learner router.
#[derive(Debug, Clone)]
pub struct LearnerState {
    pub pool: PgPool,
    /// `ExecutionControls::accept_operations`.
    pub accept_operations: bool,
}

/// The standard 503 (with `Retry-After: 1`), so a dark deployment looks like
/// a briefly unavailable one to the client.
async fn writes_disabled() -> ApiError {
    tracing::warn!("write refused: accept_operations is off on this backend");
    ApiError::unavailable()
}

/// The learner routes, relative to `/api/v2`.
pub fn router(state: LearnerState) -> Router {
    let attempts_route = get(attempts::list_attempts);
    let (attempts_route, abandon_route) = if state.accept_operations {
        (
            attempts_route.post(attempts::create_attempt),
            post(attempts::abandon_attempt),
        )
    } else {
        (attempts_route.post(writes_disabled), post(writes_disabled))
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
        .route("/assignments/{assignment_id}/attempts", attempts_route)
        .route(
            "/assignments/{assignment_id}/attempts/{attempt_id}",
            get(attempts::get_attempt),
        )
        .route(
            "/assignments/{assignment_id}/attempts/{attempt_id}/abandon",
            abandon_route,
        )
        .with_state(state)
}
