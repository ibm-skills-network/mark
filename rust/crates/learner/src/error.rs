//! One error type for every learner route, rendered in the shapes the legacy
//! `NestJS` backend produces so the gateway and web client cannot tell the two
//! backends apart.
//!
//! * Built-in Nest exceptions with a string message render as
//!   `{"message", "error", "statusCode"}` (`error` is the reason phrase).
//! * Bodies the legacy code builds by hand render as `{"statusCode", "message"}`
//!   or `{"statusCode", "code", "message"}`.
//! * Database connectivity failures render as 503 with `Retry-After: 1`; the
//!   web client retries those and never retries a 500.
//! * Anything else is a 500 whose detail goes to the log, never the body.

use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{Map, Value};
use tracing::{error, warn};

/// Machine-readable codes the web client branches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    AiTemporarilyDisabled,
    AttemptInProgress,
    AttemptTimeRangeExceeded,
    AttemptMaxReached,
    AssignmentNotPublished,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::AiTemporarilyDisabled => "AI_TEMPORARILY_DISABLED",
            ErrorCode::AttemptInProgress => "ATTEMPT_IN_PROGRESS",
            ErrorCode::AttemptTimeRangeExceeded => "ATTEMPT_TIME_RANGE_EXCEEDED",
            ErrorCode::AttemptMaxReached => "ATTEMPT_MAX_REACHED",
            ErrorCode::AssignmentNotPublished => "ASSIGNMENT_NOT_PUBLISHED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Shape {
    /// Nest built-in exception: `{message, error, statusCode}`.
    Nest,
    /// Hand-built body: `{statusCode, message}`.
    Plain,
    /// Hand-built body with a code: `{statusCode, code, message}`.
    Coded(ErrorCode),
}

/// An error a learner route answers with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    status: StatusCode,
    message: String,
    shape: Shape,
    retry_after: bool,
}

pub const UNAVAILABLE_MESSAGE: &str = "Service temporarily unavailable";
pub const INTERNAL_MESSAGE: &str = "Internal server error";
pub const FORBIDDEN_RESOURCE: &str = "Forbidden resource";

impl ApiError {
    /// A Nest built-in HTTP exception (`ForbiddenException("...")` etc.).
    pub fn nest(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            shape: Shape::Nest,
            retry_after: false,
        }
    }

    /// A hand-built `{statusCode, message}` body.
    pub fn plain(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            shape: Shape::Plain,
            retry_after: false,
        }
    }

    /// A hand-built `{statusCode, code, message}` body.
    pub fn coded(status: StatusCode, code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            shape: Shape::Coded(code),
            retry_after: false,
        }
    }

    /// What a guard returning `false` produces in Nest.
    pub fn forbidden_resource() -> Self {
        Self::nest(StatusCode::FORBIDDEN, FORBIDDEN_RESOURCE)
    }

    /// Database unreachable, pool exhausted, or a lock/statement timeout.
    pub fn unavailable() -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: UNAVAILABLE_MESSAGE.to_owned(),
            shape: Shape::Plain,
            retry_after: true,
        }
    }

    /// An unexpected failure. `detail` is logged, never returned.
    pub fn internal(detail: &dyn std::fmt::Display) -> Self {
        error!(error = %detail, "unexpected error in learner route");
        Self::plain(StatusCode::INTERNAL_SERVER_ERROR, INTERNAL_MESSAGE)
    }

    pub fn status(&self) -> StatusCode {
        self.status
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    /// The JSON body exactly as it goes on the wire.
    pub fn body(&self) -> Value {
        let mut map = Map::new();
        let code = Value::from(self.status.as_u16());
        match &self.shape {
            Shape::Nest => {
                map.insert("message".into(), Value::from(self.message.clone()));
                map.insert(
                    "error".into(),
                    Value::from(self.status.canonical_reason().unwrap_or("Error")),
                );
                map.insert("statusCode".into(), code);
            }
            Shape::Plain => {
                map.insert("statusCode".into(), code);
                map.insert("message".into(), Value::from(self.message.clone()));
            }
            Shape::Coded(c) => {
                map.insert("statusCode".into(), code);
                map.insert("code".into(), Value::from(c.as_str()));
                map.insert("message".into(), Value::from(self.message.clone()));
            }
        }
        Value::Object(map)
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.status.as_u16(), self.message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (self.status, Json(self.body())).into_response();
        if self.retry_after {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
        }
        response
    }
}

/// SQLSTATEs that mean "the database is momentarily unreachable or busy"
/// rather than "this request is wrong".
fn is_transient_sqlstate(code: &str) -> bool {
    code.starts_with("08") // connection_exception class (pgbouncer reports here too)
        || matches!(
            code,
            "53300" // too_many_connections
                | "57P01" // admin_shutdown
                | "57P02" // crash_shutdown
                | "57P03" // cannot_connect_now
                | "57014" // query_canceled (statement_timeout)
                | "55P03" // lock_not_available (lock_timeout)
                | "40001" // serialization_failure
                | "40P01" // deadlock_detected
        )
}

/// Whether a sqlx error should be answered with 503 instead of 500.
pub fn is_unavailable(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::PoolTimedOut
        | sqlx::Error::PoolClosed
        | sqlx::Error::Io(_)
        | sqlx::Error::Tls(_)
        | sqlx::Error::WorkerCrashed => true,
        sqlx::Error::Database(db) => db.code().is_some_and(|c| is_transient_sqlstate(&c)),
        _ => false,
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        if is_unavailable(&err) {
            warn!(error = %err, "database unavailable; answering 503");
            Self::unavailable()
        } else {
            Self::internal(&err)
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    async fn render(err: ApiError) -> (StatusCode, Option<String>, String) {
        let response = err.into_response();
        let status = response.status();
        let retry = response
            .headers()
            .get(header::RETRY_AFTER)
            .map(|v| v.to_str().unwrap().to_owned());
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, retry, String::from_utf8(bytes.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn nest_shape_matches_builtin_exceptions() {
        let (status, retry, body) = render(ApiError::nest(
            StatusCode::NOT_FOUND,
            "Assignment not found",
        ))
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(retry, None);
        assert_eq!(
            body,
            r#"{"message":"Assignment not found","error":"Not Found","statusCode":404}"#
        );
        let (_, _, body) = render(ApiError::forbidden_resource()).await;
        assert_eq!(
            body,
            r#"{"message":"Forbidden resource","error":"Forbidden","statusCode":403}"#
        );
    }

    #[tokio::test]
    async fn coded_and_plain_shapes() {
        let (status, _, body) = render(ApiError::coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::AttemptMaxReached,
            "Maximum number of attempts reached for this assignment.",
        ))
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body,
            r#"{"statusCode":422,"code":"ATTEMPT_MAX_REACHED","message":"Maximum number of attempts reached for this assignment."}"#
        );
        let (status, _, body) =
            render(ApiError::plain(StatusCode::TOO_MANY_REQUESTS, "wait")).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(body, r#"{"statusCode":429,"message":"wait"}"#);
    }

    #[tokio::test]
    async fn pool_timeout_is_503_with_retry_after() {
        let (status, retry, body) = render(ApiError::from(sqlx::Error::PoolTimedOut)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(retry.as_deref(), Some("1"));
        assert_eq!(
            body,
            r#"{"statusCode":503,"message":"Service temporarily unavailable"}"#
        );
    }

    #[tokio::test]
    async fn other_errors_are_opaque_500() {
        let (status, retry, body) = render(ApiError::from(sqlx::Error::RowNotFound)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(retry, None);
        assert_eq!(
            body,
            r#"{"statusCode":500,"message":"Internal server error"}"#
        );
        assert!(!body.contains("RowNotFound"));
    }

    #[test]
    fn transient_sqlstates() {
        assert!(is_transient_sqlstate("08006"));
        assert!(is_transient_sqlstate("08P01"));
        assert!(is_transient_sqlstate("57014"));
        assert!(!is_transient_sqlstate("42703"));
        assert!(!is_transient_sqlstate("23505"));
    }
}
