//! Submission deadline rules (`submission-deadline.helper.ts`) and the 409
//! bodies for an attempt that no longer accepts a submit.

use axum::http::StatusCode;
use chrono::{Duration, NaiveDateTime};
use serde_json::json;

use crate::error::ApiError;

/// How long after `expiresAt` a submit still counts as on time.
pub const SUBMISSION_GRACE_MS: i64 = 30_000;

/// What closing an attempt at its deadline writes to `comments`.
pub const EXPIRED_ATTEMPT_COMMENT: &str = "You submitted the assignment after the deadline. Your submission will not be graded. If you don't have any more attempts, please contact your instructor.";

/// Prefix of what the older (v1) expiry path wrote.
const V1_TIME_LIMIT_COMMENT_PREFIX: &str =
    "Your assignment was automatically submitted because the time limit was reached.";

pub const CLOSED_AT_TIME_LIMIT_MESSAGE: &str = "This attempt was already closed at its time limit.";
pub const ALREADY_SUBMITTED_MESSAGE: &str = "This attempt has already been submitted.";

/// A submit received at `received_at` is past `expires_at` plus the grace
/// window. An attempt without a deadline never expires.
pub fn past_grace(expires_at: Option<NaiveDateTime>, received_at: NaiveDateTime) -> bool {
    expires_at.is_some_and(|deadline| {
        received_at - Duration::milliseconds(SUBMISSION_GRACE_MS) > deadline
    })
}

/// Whether a submitted attempt was closed by a deadline check, not the learner.
pub fn closed_at_time_limit(comments: Option<&str>) -> bool {
    comments.is_some_and(|c| {
        c == EXPIRED_ATTEMPT_COMMENT || c.starts_with(V1_TIME_LIMIT_COMMENT_PREFIX)
    })
}

/// Why an attempt refuses a submit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClosedReason {
    TimeLimit,
    AlreadySubmitted,
}

impl ClosedReason {
    pub fn from_comments(comments: Option<&str>) -> Self {
        if closed_at_time_limit(comments) {
            Self::TimeLimit
        } else {
            Self::AlreadySubmitted
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::TimeLimit => "time_limit",
            Self::AlreadySubmitted => "already_submitted",
        }
    }
}

/// The 409 the web client turns into "go to the results page".
pub fn attempt_closed(attempt_id: i32, reason: ClosedReason) -> ApiError {
    let (code, message) = match reason {
        ClosedReason::TimeLimit => ("ATTEMPT_CLOSED_AT_TIME_LIMIT", CLOSED_AT_TIME_LIMIT_MESSAGE),
        ClosedReason::AlreadySubmitted => ("ATTEMPT_ALREADY_SUBMITTED", ALREADY_SUBMITTED_MESSAGE),
    };
    ApiError::raw(
        StatusCode::CONFLICT,
        json!({
            "statusCode": 409,
            "error": "Conflict",
            "code": code,
            "message": message,
            "attemptId": attempt_id,
        }),
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn at(h: u32, m: u32, s: u32, ms: u32) -> NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 10, 24)
            .unwrap()
            .and_hms_milli_opt(h, m, s, ms)
            .unwrap()
    }

    #[test]
    fn grace_is_thirty_seconds_after_the_deadline() {
        let deadline = Some(at(10, 0, 0, 0));
        assert!(!past_grace(deadline, at(9, 59, 0, 0)));
        assert!(!past_grace(deadline, at(10, 0, 0, 0)));
        assert!(!past_grace(deadline, at(10, 0, 30, 0)));
        assert!(past_grace(deadline, at(10, 0, 30, 1)));
        assert!(!past_grace(None, at(23, 0, 0, 0)));
    }

    #[test]
    fn time_limit_comments() {
        assert!(closed_at_time_limit(Some(EXPIRED_ATTEMPT_COMMENT)));
        assert!(closed_at_time_limit(Some(
            "Your assignment was automatically submitted because the time limit was reached. Extra."
        )));
        assert!(!closed_at_time_limit(Some("Great work")));
        assert!(!closed_at_time_limit(None));
        assert_eq!(
            ClosedReason::from_comments(None),
            ClosedReason::AlreadySubmitted
        );
    }

    #[test]
    fn closed_bodies() {
        let body = attempt_closed(71, ClosedReason::TimeLimit).body();
        assert_eq!(
            body.to_string(),
            r#"{"statusCode":409,"error":"Conflict","code":"ATTEMPT_CLOSED_AT_TIME_LIMIT","message":"This attempt was already closed at its time limit.","attemptId":71}"#
        );
        let body = attempt_closed(71, ClosedReason::AlreadySubmitted).body();
        assert_eq!(body["code"], "ATTEMPT_ALREADY_SUBMITTED");
        assert_eq!(body["message"], "This attempt has already been submitted.");
    }
}
