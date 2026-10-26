//! Access checks, ported from the legacy `AssignmentAccessControlGuard`
//! (assignment reads) and `AssignmentAttemptAccessControlGuard` (attempt
//! routes). Both run on every request, in the handler, against the database.

use axum::http::StatusCode;
use sqlx::PgConnection;
use tracing::warn;

use crate::error::ApiError;
use crate::params::parse_strict_positive;
use crate::principal::{Role, UserSession};
use crate::store::{self, AttemptRow, Owner};

const ACCESS_DENIED: &str = "Access denied to this assignment";

fn assignment_not_found() -> ApiError {
    ApiError::nest(StatusCode::NOT_FOUND, "Assignment not found")
}

/// Authors act on the assignment their launch named, never another one.
fn check_author_scope(
    session: &UserSession,
    role: Role,
    assignment_id: Option<i32>,
) -> Result<(), ApiError> {
    if role == Role::Author
        && (assignment_id.is_none() || session.assignment_id != assignment_id.map(i64::from))
    {
        warn!(
            user_id = session.log_user(),
            assignment_id,
            session_assignment_id = session.assignment_id,
            denial_reason = "author_other_assignment",
            "access denied: author launch targets another assignment"
        );
        return Err(ApiError::nest(StatusCode::FORBIDDEN, ACCESS_DENIED));
    }
    Ok(())
}

/// Whether the self-heal may create the missing group link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Heal {
    Allowed,
    Never,
}

/// The checks for the assignment routes that need no database: author
/// scope, then 404 for a well-formed id that cannot name a row (`None`).
/// Run before acquiring a connection.
pub fn assignment_route_id(
    session: &UserSession,
    role: Role,
    assignment_id: Option<i32>,
) -> Result<i32, ApiError> {
    check_author_scope(session, role, assignment_id)?;
    assignment_id.ok_or_else(|| {
        warn!(
            user_id = session.log_user(),
            denial_reason = "assignment_id_out_of_range",
            "access denied"
        );
        assignment_not_found()
    })
}

/// Assignment-level access for `GET /assignments/{id}` (with heal) and
/// `GET /assignments/{id}/languages` (without). `id` comes from
/// [`assignment_route_id`].
pub async fn assignment_read(
    conn: &mut PgConnection,
    session: &UserSession,
    id: i32,
    heal: Heal,
) -> Result<i32, ApiError> {
    let group = session.non_empty_group_id();
    let Some(row) = store::assignment_access(conn, id, group).await? else {
        warn!(
            assignment_id = id,
            user_id = session.log_user(),
            denial_reason = "assignment_not_found",
            "access denied"
        );
        return Err(assignment_not_found());
    };
    if row.linked {
        return Ok(id);
    }
    let launch_declares_this = session.assignment_id == Some(i64::from(id));
    match (heal, group) {
        (Heal::Allowed, Some(group)) if launch_declares_this => {
            store::heal_group_link(conn, id, group).await?;
            warn!(
                assignment_id = id,
                group_id = group,
                user_id = session.log_user(),
                "assignment_group_auto_linked: created missing group link from signed launch session"
            );
            Ok(id)
        }
        _ => {
            warn!(
                assignment_id = id,
                group_id = group.unwrap_or(""),
                user_id = session.log_user(),
                denial_reason = "no_group_link",
                "access denied: group has no link to this assignment"
            );
            Err(ApiError::nest(StatusCode::FORBIDDEN, ACCESS_DENIED))
        }
    }
}

/// Strict attempt-route assignment id, or 403.
pub fn attempt_route_assignment_id(raw: &str, session: &UserSession) -> Result<i32, ApiError> {
    parse_strict_positive(raw).ok_or_else(|| {
        warn!(
            user_id = session.log_user(),
            denial_reason = "invalid_assignment_id",
            "attempt access denied"
        );
        ApiError::nest(StatusCode::FORBIDDEN, "Invalid assignment ID")
    })
}

/// Strict attempt id, or 403.
pub fn attempt_route_attempt_id(raw: &str, session: &UserSession) -> Result<i32, ApiError> {
    parse_strict_positive(raw).ok_or_else(|| {
        warn!(
            user_id = session.log_user(),
            denial_reason = "invalid_attempt_id",
            "attempt access denied"
        );
        ApiError::nest(StatusCode::FORBIDDEN, "Invalid attempt ID")
    })
}

/// Group-link access for attempt routes without an attempt id (list,
/// create). Never heals.
pub async fn attempt_collection(
    conn: &mut PgConnection,
    session: &UserSession,
    role: Role,
    assignment_id: i32,
) -> Result<(), ApiError> {
    check_author_scope(session, role, Some(assignment_id))?;
    let group = session.non_empty_group_id();
    let Some(row) = store::assignment_access(conn, assignment_id, group).await? else {
        warn!(
            assignment_id,
            user_id = session.log_user(),
            denial_reason = "assignment_not_found",
            "attempt access denied"
        );
        return Err(assignment_not_found());
    };
    if !row.linked {
        warn!(
            assignment_id,
            user_id = session.log_user(),
            group_id = group.unwrap_or(""),
            denial_reason = "no_group_link",
            "attempt access denied: no group link"
        );
        return Err(ApiError::forbidden_resource());
    }
    Ok(())
}

/// Whether the request only reads the attempt (owner exemption applies).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Intent {
    Read,
    Write,
}

/// Access to one attempt. Learners must own it; a learner may read (not
/// write) their own attempt without a current group link. Missing or
/// unowned -> 404.
pub async fn attempt_item(
    conn: &mut PgConnection,
    session: &UserSession,
    role: Role,
    assignment_id: i32,
    attempt_id: i32,
    intent: Intent,
) -> Result<AttemptRow, ApiError> {
    let owner = match role {
        Role::Learner => match session.non_empty_user_id() {
            Some(user) => Owner::User(user),
            None => {
                warn!(
                    assignment_id,
                    attempt_id,
                    denial_reason = "missing_session_user_id",
                    "attempt access denied"
                );
                return Err(ApiError::forbidden_resource());
            }
        },
        Role::Author | Role::Admin => Owner::Anyone,
    };
    check_author_scope(session, role, Some(assignment_id))?;

    let group = session.non_empty_group_id();
    let Some(access) = store::assignment_access(conn, assignment_id, group).await? else {
        warn!(
            assignment_id,
            attempt_id,
            user_id = session.log_user(),
            denial_reason = "assignment_not_found",
            "attempt access denied"
        );
        return Err(assignment_not_found());
    };
    let attempt = store::find_attempt(conn, attempt_id, assignment_id, owner).await?;
    // Re-assert ownership on the row itself, not just "a row came back".
    let owned_by_learner = match (owner, attempt.as_ref()) {
        (Owner::User(user), Some(row)) => row.user_id == user,
        _ => false,
    };

    if !access.linked {
        if !(owned_by_learner && intent == Intent::Read) {
            warn!(
                assignment_id,
                attempt_id,
                user_id = session.log_user(),
                group_id = group.unwrap_or(""),
                denial_reason = "no_group_link",
                "attempt access denied: no group link"
            );
            return Err(ApiError::forbidden_resource());
        }
        warn!(
            assignment_id,
            attempt_id,
            user_id = session.log_user(),
            allow_reason = "owner_read_without_group_link",
            "attempt access allowed: own attempt read without a current group link"
        );
    }

    match attempt {
        Some(row) if owned_by_learner || matches!(owner, Owner::Anyone) => Ok(row),
        _ => {
            warn!(
                assignment_id,
                attempt_id,
                user_id = session.log_user(),
                denial_reason = "attempt_not_found_or_unowned",
                "attempt access denied"
            );
            Err(ApiError::nest(
                StatusCode::NOT_FOUND,
                "Attempt not found or not owned by the user",
            ))
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn session(role: &str, assignment: Option<i64>) -> UserSession {
        UserSession {
            user_id: Some("u@x".into()),
            role: crate::principal::UserSession::parse(
                format!(r#"{{"role":"{role}"}}"#).as_bytes(),
            )
            .unwrap()
            .role,
            group_id: Some("g".into()),
            assignment_id: assignment,
            grading_callback_required: false,
        }
    }

    #[test]
    fn authors_are_scoped_to_their_launch() {
        let author = session("author", Some(5));
        assert!(check_author_scope(&author, Role::Author, Some(5)).is_ok());
        let err = check_author_scope(&author, Role::Author, Some(6)).unwrap_err();
        assert_eq!(err.status(), StatusCode::FORBIDDEN);
        assert_eq!(err.message(), ACCESS_DENIED);
        assert!(check_author_scope(&author, Role::Author, None).is_err());
        let learner = session("learner", Some(5));
        assert!(check_author_scope(&learner, Role::Learner, Some(6)).is_ok());
    }

    #[test]
    fn impossible_assignment_ids_are_404() {
        let learner = session("learner", Some(5));
        assert_eq!(
            assignment_route_id(&learner, Role::Learner, Some(5)).unwrap(),
            5
        );
        // parse_int_pipe yields None for 0, negatives and ids above i32::MAX.
        for raw in ["0", "-3", "2147483648", "99999999999999999999"] {
            let parsed = crate::params::parse_int_pipe(raw).unwrap();
            let err = assignment_route_id(&learner, Role::Learner, parsed).unwrap_err();
            assert_eq!(
                (err.status(), err.message()),
                (StatusCode::NOT_FOUND, "Assignment not found"),
                "{raw}"
            );
        }
    }

    #[test]
    fn impossible_attempt_route_ids_are_403() {
        let s = session("learner", None);
        for raw in ["0", "2147483648", "-1", "1.5"] {
            let err = attempt_route_assignment_id(raw, &s).unwrap_err();
            assert_eq!(
                (err.status(), err.message()),
                (StatusCode::FORBIDDEN, "Invalid assignment ID"),
                "{raw}"
            );
            let err = attempt_route_attempt_id(raw, &s).unwrap_err();
            assert_eq!(
                (err.status(), err.message()),
                (StatusCode::FORBIDDEN, "Invalid attempt ID"),
                "{raw}"
            );
        }
    }

    #[test]
    fn attempt_route_ids_are_403() {
        let s = session("learner", None);
        assert_eq!(attempt_route_assignment_id("12", &s).unwrap(), 12);
        let err = attempt_route_assignment_id("012", &s).unwrap_err();
        assert_eq!(
            (err.status(), err.message()),
            (StatusCode::FORBIDDEN, "Invalid assignment ID")
        );
        let err = attempt_route_attempt_id("x", &s).unwrap_err();
        assert_eq!(
            (err.status(), err.message()),
            (StatusCode::FORBIDDEN, "Invalid attempt ID")
        );
    }
}
