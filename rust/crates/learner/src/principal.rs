//! The caller's identity, as forwarded by the api-gateway.
//!
//! The gateway verifies the session cookie and sends a `user-session` header
//! holding ASCII-escaped JSON. This service trusts that header and must only
//! be reachable from the gateway. Missing header -> 401, unparsable -> 400.
//! Unknown keys are ignored; a present field of the wrong type is a malformed
//! header (400). The guards decide what an absent value means.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use serde_json::Value;
use tracing::warn;

use crate::error::ApiError;

pub const USER_SESSION_HEADER: &str = "user-session";

/// `UserRole` in the legacy API; lower-case on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Learner,
    Author,
    Admin,
}

impl Role {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "learner" => Some(Role::Learner),
            "author" => Some(Role::Author),
            "admin" => Some(Role::Admin),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Role::Learner => "learner",
            Role::Author => "author",
            Role::Admin => "admin",
        }
    }
}

/// The parts of `UserSession` the learner routes use.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UserSession {
    /// An email address. May be absent or empty in a malformed session; the
    /// attempt guards refuse such sessions before querying.
    pub user_id: Option<String>,
    /// `None` when absent or not one of the known roles.
    pub role: Option<Role>,
    pub group_id: Option<String>,
    pub assignment_id: Option<i64>,
}

impl UserSession {
    /// Parse the header value. `Err` means "unparsable" (400).
    pub fn parse(raw: &[u8]) -> Result<Self, ApiError> {
        let invalid = || ApiError::nest(StatusCode::BAD_REQUEST, "Invalid user-session header");
        let value: Value = serde_json::from_slice(raw).map_err(|_| invalid())?;
        let Value::Object(map) = value else {
            return Err(invalid());
        };
        // A present field of the wrong type is a malformed header (400), the
        // same as the legacy middleware; a JSON null counts as absent.
        let string = |key: &str| match map.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.clone())),
            Some(_) => Err(invalid()),
        };
        let role = string("role")?;
        let assignment_id = match map.get("assignmentId") {
            None | Some(Value::Null) => None,
            Some(v @ Value::Number(_)) => Some(integral(v).ok_or_else(invalid)?),
            Some(_) => return Err(invalid()),
        };
        Ok(Self {
            user_id: string("userId")?,
            role: role.as_deref().and_then(Role::parse),
            group_id: string("groupId")?,
            assignment_id,
        })
    }

    /// A non-empty user id, as the attempt guard requires for learners.
    pub fn non_empty_user_id(&self) -> Option<&str> {
        self.user_id.as_deref().filter(|u| !u.is_empty())
    }

    /// A non-empty group id. An absent group never matches a link row.
    pub fn non_empty_group_id(&self) -> Option<&str> {
        self.group_id.as_deref().filter(|g| !g.is_empty())
    }

    /// Role gate (`@Roles(...)`): anything else is 403 "Forbidden resource".
    pub fn require_role(&self, allowed: &[Role]) -> Result<Role, ApiError> {
        match self.role {
            Some(role) if allowed.contains(&role) => Ok(role),
            other => {
                warn!(
                    user_id = self.user_id.as_deref().unwrap_or(""),
                    role = other.map_or("unknown", Role::as_str),
                    denial_reason = "role_not_allowed",
                    "learner route denied: role not allowed"
                );
                Err(ApiError::forbidden_resource())
            }
        }
    }

    pub fn log_user(&self) -> &str {
        self.user_id.as_deref().unwrap_or("")
    }
}

/// JSON numbers that are whole (`5` or `5.0`), like a JS `===` comparison
/// against an integer route id would accept.
fn integral(value: &Value) -> Option<i64> {
    if let Some(i) = value.as_i64() {
        return Some(i);
    }
    let f = value.as_f64()?;
    if f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 {
        #[allow(clippy::cast_possible_truncation)]
        // Whole and within the exactly representable range checked above.
        return Some(f as i64);
    }
    None
}

impl<S: Send + Sync> FromRequestParts<S> for UserSession {
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut Parts,
        _state: &S,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        std::future::ready(Self::from_parts(parts))
    }
}

impl UserSession {
    fn from_parts(parts: &Parts) -> Result<Self, ApiError> {
        let raw = parts
            .headers
            .get(USER_SESSION_HEADER)
            .map(axum::http::HeaderValue::as_bytes)
            .filter(|b| !b.is_empty());
        let Some(raw) = raw else {
            warn!(
                path = %parts.uri.path(),
                denial_reason = "missing_user_session",
                "user-session header missing"
            );
            return Err(ApiError::nest(
                StatusCode::UNAUTHORIZED,
                "Missing or invalid user session",
            ));
        };
        UserSession::parse(raw).inspect_err(|_| {
            warn!(
                path = %parts.uri.path(),
                denial_reason = "unparsable_user_session",
                "user-session header parse failed"
            );
        })
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use axum::http::Request;

    #[test]
    fn parses_a_gateway_session() {
        let s = UserSession::parse(
            br#"{"userId":"a@b.c","role":"learner","groupId":"g1","assignmentId":42,"returnUrl":"x","extra":{"y":1}}"#,
        )
        .unwrap();
        assert_eq!(s.user_id.as_deref(), Some("a@b.c"));
        assert_eq!(s.role, Some(Role::Learner));
        assert_eq!(s.group_id.as_deref(), Some("g1"));
        assert_eq!(s.assignment_id, Some(42));
    }

    #[test]
    fn decodes_ascii_escaped_unicode() {
        let s = UserSession::parse(
            br#"{"userId":"j\u00f6rg@example.com","role":"author","groupId":"\u4e2d\u6587","assignmentId":7.0}"#,
        )
        .unwrap();
        assert_eq!(s.user_id.as_deref(), Some("jörg@example.com"));
        assert_eq!(s.group_id.as_deref(), Some("中文"));
        assert_eq!(s.role, Some(Role::Author));
        assert_eq!(s.assignment_id, Some(7));
    }

    #[test]
    fn unknown_role_and_null_fields_are_absent() {
        let s = UserSession::parse(br#"{"role":"Learner","groupId":null,"assignmentId":null}"#)
            .unwrap();
        assert_eq!(s.role, None);
        assert_eq!(s.group_id, None);
        assert_eq!(s.assignment_id, None);
        assert_eq!(s.user_id, None);
        assert!(s.require_role(&[Role::Learner]).is_err());
    }

    #[test]
    fn mistyped_fields_are_400() {
        for raw in [
            &br#"{"userId":5}"#[..],
            br#"{"groupId":5}"#,
            br#"{"role":7}"#,
            br#"{"assignmentId":"7"}"#,
            br#"{"assignmentId":7.5}"#,
        ] {
            let err = UserSession::parse(raw).unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST, "{raw:?}");
            assert_eq!(err.message(), "Invalid user-session header");
        }
    }

    #[test]
    fn garbage_is_400() {
        for raw in [&b"not json"[..], b"null", b"[1]", b"\"s\"", b"{"] {
            let err = UserSession::parse(raw).unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST);
            assert_eq!(err.message(), "Invalid user-session header");
        }
    }

    #[test]
    fn admin_is_refused_by_role_gate() {
        let s = UserSession::parse(br#"{"userId":"a","role":"admin"}"#).unwrap();
        let err = s.require_role(&[Role::Learner, Role::Author]).unwrap_err();
        assert_eq!(err.status(), StatusCode::FORBIDDEN);
        assert_eq!(err.message(), "Forbidden resource");
    }

    async fn extract(header: Option<&str>) -> Result<UserSession, ApiError> {
        let mut builder = Request::get("/x");
        if let Some(h) = header {
            builder = builder.header(USER_SESSION_HEADER, h);
        }
        let (mut parts, ()) = builder.body(()).unwrap().into_parts();
        <UserSession as FromRequestParts<()>>::from_request_parts(&mut parts, &()).await
    }

    #[tokio::test]
    async fn missing_or_empty_header_is_401() {
        for h in [None, Some("")] {
            let err = extract(h).await.unwrap_err();
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(err.message(), "Missing or invalid user session");
        }
        assert_eq!(
            extract(Some("{oops")).await.unwrap_err().status(),
            StatusCode::BAD_REQUEST
        );
        assert!(extract(Some(r#"{"userId":"u","role":"learner"}"#))
            .await
            .is_ok());
    }
}
