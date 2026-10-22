//! Liveness and readiness.
//!
//! Paths match the legacy API (`/health/liveness`, `/health/readiness`) so
//! the existing chart probe configuration carries over unchanged.
//!
//! * Liveness answers as long as the process can serve HTTP. It never
//!   consults dependencies: a broken database must take the pod out of
//!   rotation, not restart it.
//! * Readiness runs every registered [`ReadinessProbe`] with a bounded
//!   timeout and returns 503 if any fails. The body lists each probe so an
//!   operator can see which dependency is the problem.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use sqlx::PgPool;

use crate::build_info::BUILD;
use crate::config::{ExecutionControls, Role};

/// A dependency check that gates readiness.
#[async_trait::async_trait]
pub trait ReadinessProbe: Send + Sync {
    fn name(&self) -> &'static str;
    async fn check(&self) -> Result<(), String>;
}

/// Shared state for the health router.
#[derive(Clone)]
pub struct HealthState {
    inner: Arc<Inner>,
}

struct Inner {
    role: Role,
    service_name: String,
    controls: ExecutionControls,
    probe_timeout: Duration,
    probes: Vec<Box<dyn ReadinessProbe>>,
}

impl std::fmt::Debug for HealthState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HealthState")
            .field("role", &self.inner.role)
            .field("service_name", &self.inner.service_name)
            .field("probes", &self.inner.probes.len())
            .finish_non_exhaustive()
    }
}

impl HealthState {
    pub fn new(role: Role, service_name: impl Into<String>, controls: ExecutionControls) -> Self {
        Self {
            inner: Arc::new(Inner {
                role,
                service_name: service_name.into(),
                controls,
                probe_timeout: Duration::from_secs(3),
                probes: Vec::new(),
            }),
        }
    }

    /// Register a probe.
    ///
    /// # Panics
    /// If called after the state has been cloned into a router.
    #[must_use]
    pub fn with_probe(mut self, probe: impl ReadinessProbe + 'static) -> Self {
        let inner = Arc::get_mut(&mut self.inner)
            .unwrap_or_else(|| panic!("with_probe called after HealthState was shared"));
        inner.probes.push(Box::new(probe));
        self
    }

    /// Bound each probe's execution time.
    ///
    /// # Panics
    /// If called after the state has been cloned into a router.
    #[must_use]
    pub fn with_probe_timeout(mut self, timeout: Duration) -> Self {
        let inner = Arc::get_mut(&mut self.inner)
            .unwrap_or_else(|| panic!("with_probe_timeout called after HealthState was shared"));
        inner.probe_timeout = timeout;
        self
    }

    pub fn router(self) -> Router {
        Router::new()
            .route("/health/liveness", get(liveness))
            .route("/health/readiness", get(readiness))
            .with_state(self)
    }
}

#[derive(Debug, Serialize)]
struct LivenessBody {
    status: &'static str,
    service: String,
    role: String,
    version: &'static str,
    build_sha: &'static str,
}

#[derive(Debug, Serialize)]
struct ReadinessBody {
    status: &'static str,
    service: String,
    role: String,
    version: &'static str,
    build_sha: &'static str,
    controls: Controls,
    checks: Vec<CheckResult>,
}

#[derive(Debug, Serialize)]
struct Controls {
    accept_operations: bool,
    consume_work: bool,
    dispatch_external_effects: bool,
}

#[derive(Debug, Serialize)]
struct CheckResult {
    name: &'static str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    duration_ms: u64,
}

async fn liveness(State(state): State<HealthState>) -> Json<LivenessBody> {
    Json(LivenessBody {
        status: "ok",
        service: state.inner.service_name.clone(),
        role: state.inner.role.to_string(),
        version: BUILD.crate_version,
        build_sha: BUILD.git_sha,
    })
}

async fn readiness(State(state): State<HealthState>) -> Response {
    let mut checks = Vec::with_capacity(state.inner.probes.len());
    let mut healthy = true;

    for probe in &state.inner.probes {
        let started = std::time::Instant::now();
        let outcome = match tokio::time::timeout(state.inner.probe_timeout, probe.check()).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(reason)) => Err(reason),
            Err(_) => Err(format!(
                "timed out after {}ms",
                state.inner.probe_timeout.as_millis()
            )),
        };
        let duration_ms = crate::millis(started.elapsed());
        match outcome {
            Ok(()) => checks.push(CheckResult {
                name: probe.name(),
                status: "ok",
                error: None,
                duration_ms,
            }),
            Err(error) => {
                healthy = false;
                tracing::warn!(probe = probe.name(), %error, "readiness probe failed");
                checks.push(CheckResult {
                    name: probe.name(),
                    status: "error",
                    error: Some(error),
                    duration_ms,
                });
            }
        }
    }

    let body = ReadinessBody {
        status: if healthy { "ok" } else { "error" },
        service: state.inner.service_name.clone(),
        role: state.inner.role.to_string(),
        version: BUILD.crate_version,
        build_sha: BUILD.git_sha,
        controls: Controls {
            accept_operations: state.inner.controls.accept_operations,
            consume_work: state.inner.controls.consume_work,
            dispatch_external_effects: state.inner.controls.dispatch_external_effects,
        },
        checks,
    };
    let status = if healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(body)).into_response()
}

/// Readiness probe backed by a PostgreSQL pool ping.
#[derive(Debug, Clone)]
pub struct DatabaseProbe {
    pool: PgPool,
    timeout: Duration,
}

impl DatabaseProbe {
    pub fn new(pool: PgPool, timeout: Duration) -> Self {
        Self { pool, timeout }
    }
}

#[async_trait::async_trait]
impl ReadinessProbe for DatabaseProbe {
    fn name(&self) -> &'static str {
        "database"
    }

    async fn check(&self) -> Result<(), String> {
        crate::db::ping(&self.pool, self.timeout)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    struct Always(Result<(), &'static str>);

    #[async_trait::async_trait]
    impl ReadinessProbe for Always {
        fn name(&self) -> &'static str {
            "stub"
        }
        async fn check(&self) -> Result<(), String> {
            self.0.map_err(str::to_owned)
        }
    }

    struct Hang;

    #[async_trait::async_trait]
    impl ReadinessProbe for Hang {
        fn name(&self) -> &'static str {
            "hang"
        }
        async fn check(&self) -> Result<(), String> {
            std::future::pending().await
        }
    }

    async fn call(router: Router, path: &str) -> (StatusCode, serde_json::Value) {
        let response = router
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    fn state() -> HealthState {
        HealthState::new(Role::Api, "test-api", ExecutionControls::default())
    }

    #[tokio::test]
    async fn liveness_never_consults_probes() {
        let router = state().with_probe(Always(Err("down"))).router();
        let (status, body) = call(router, "/health/liveness").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
        assert_eq!(body["role"], "api");
        assert_eq!(body["service"], "test-api");
    }

    #[tokio::test]
    async fn readiness_ok_when_all_probes_pass() {
        let router = state().with_probe(Always(Ok(()))).router();
        let (status, body) = call(router, "/health/readiness").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
        assert_eq!(body["checks"][0]["name"], "stub");
        assert_eq!(body["checks"][0]["status"], "ok");
        assert_eq!(body["controls"]["consume_work"], false);
    }

    #[tokio::test]
    async fn readiness_503_when_a_probe_fails() {
        let router = state()
            .with_probe(Always(Ok(())))
            .with_probe(Always(Err("connection refused")))
            .router();
        let (status, body) = call(router, "/health/readiness").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["status"], "error");
        assert_eq!(body["checks"][1]["error"], "connection refused");
    }

    #[tokio::test]
    async fn readiness_bounds_hanging_probes() {
        let router = state()
            .with_probe_timeout(Duration::from_millis(20))
            .with_probe(Hang)
            .router();
        let (status, body) = call(router, "/health/readiness").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(body["checks"][0]["error"]
            .as_str()
            .unwrap()
            .starts_with("timed out"));
    }

    #[tokio::test]
    async fn readiness_reports_execution_controls() {
        let controls = ExecutionControls {
            accept_operations: true,
            consume_work: false,
            dispatch_external_effects: false,
        };
        let router = HealthState::new(Role::Worker, "w", controls).router();
        let (status, body) = call(router, "/health/readiness").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["controls"]["accept_operations"], true);
        assert_eq!(body["role"], "worker");
    }
}
