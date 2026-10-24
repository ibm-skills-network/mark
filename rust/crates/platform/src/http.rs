//! HTTP server scaffolding shared by the API and the worker's probe port.
//!
//! Every request gets a request ID (the gateway's `x-request-id` or Akamai's
//! `akamai-grn` if present, otherwise a fresh UUID), a tracing span carrying
//! that ID, a hard timeout, and a body size limit. Handlers never see a
//! request without these.

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::Request;
use axum::http::{header::HeaderName, HeaderValue};
use axum::Router;
use tokio::net::TcpListener;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::request_id::{
    MakeRequestId, PropagateRequestIdLayer, RequestId, SetRequestIdLayer,
};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use tracing::{info, info_span, warn, Span};

pub const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
const AKAMAI_GRN: HeaderName = HeaderName::from_static("akamai-grn");

/// Default request body ceiling for JSON endpoints: axum's own per-extractor
/// limit, which every route keeps unless it opts in to more with
/// `DefaultBodyLimit`.
pub const DEFAULT_BODY_LIMIT: usize = 2 * 1024 * 1024;

/// Hard ceiling for any request body, enforced before routing. Only routes
/// that raise their extractor limit (the learner submit carries every answer
/// of an attempt) can get near it.
pub const MAX_BODY_LIMIT: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default)]
struct UuidRequestId;

impl MakeRequestId for UuidRequestId {
    fn make_request_id<B>(&mut self, request: &axum::http::Request<B>) -> Option<RequestId> {
        // Prefer an upstream ID so the gateway, legacy API, and this process
        // share one correlation key for the same user request.
        if let Some(upstream) = request.headers().get(&AKAMAI_GRN) {
            return Some(RequestId::new(upstream.clone()));
        }
        let id = uuid::Uuid::new_v4().to_string();
        HeaderValue::from_str(&id).ok().map(RequestId::new)
    }
}

/// Wrap `router` with the standard middleware stack.
pub fn with_middleware(router: Router, request_timeout: Duration) -> Router {
    router
        .layer(RequestBodyLimitLayer::new(MAX_BODY_LIMIT))
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::GATEWAY_TIMEOUT,
            request_timeout,
        ))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &Request| {
                    let request_id = request
                        .headers()
                        .get(&REQUEST_ID_HEADER)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("none");
                    info_span!(
                        "http_request",
                        method = %request.method(),
                        path = %request.uri().path(),
                        request_id = %request_id,
                        status = tracing::field::Empty,
                    )
                })
                .on_response(
                    |response: &axum::http::Response<_>, latency: Duration, span: &Span| {
                        span.record("status", response.status().as_u16());
                        tracing::info!(
                            status = response.status().as_u16(),
                            latency_ms = crate::millis(latency),
                            "request completed"
                        );
                    },
                ),
        )
        .layer(PropagateRequestIdLayer::new(REQUEST_ID_HEADER))
        .layer(SetRequestIdLayer::new(REQUEST_ID_HEADER, UuidRequestId))
}

/// Bind and serve until the shutdown signal fires, then finish in-flight
/// requests within the grace period. If connections are still open when the
/// grace period elapses the server returns anyway so the pod can exit.
pub async fn serve(router: Router, addr: SocketAddr, grace: Duration) -> anyhow::Result<()> {
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| anyhow::anyhow!("failed to bind {addr}: {e}"))?;
    info!(%addr, "http server listening");

    let (tx, rx) = tokio::sync::watch::channel(false);
    tokio::spawn(async move {
        crate::shutdown::signal().await;
        let _ = tx.send(true);
    });

    let mut drain_rx = rx.clone();
    let server = axum::serve(listener, router).with_graceful_shutdown(async move {
        let _ = drain_rx.wait_for(|stop| *stop).await;
        info!(grace_ms = crate::millis(grace), "draining http connections");
    });

    let mut deadline_rx = rx;
    let deadline = async move {
        let _ = deadline_rx.wait_for(|stop| *stop).await;
        tokio::time::sleep(grace).await;
    };

    tokio::select! {
        result = server => result.map_err(Into::into),
        () = deadline => {
            warn!("shutdown grace period elapsed with connections still open; exiting");
            Ok(())
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::routing::get;
    use tower::ServiceExt;

    fn app() -> Router {
        with_middleware(
            Router::new().route(
                "/",
                get(|| async { "ok" }).post(|body: String| async move { body }),
            ),
            Duration::from_secs(1),
        )
    }

    #[tokio::test]
    async fn generates_request_id_when_absent() {
        let response = app()
            .oneshot(axum::http::Request::get("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let id = response.headers().get(REQUEST_ID_HEADER).unwrap();
        assert!(uuid::Uuid::parse_str(id.to_str().unwrap()).is_ok());
    }

    #[tokio::test]
    async fn preserves_upstream_request_id() {
        let response = app()
            .oneshot(
                axum::http::Request::get("/")
                    .header("x-request-id", "gateway-123")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.headers().get(REQUEST_ID_HEADER).unwrap(),
            "gateway-123"
        );
    }

    #[tokio::test]
    async fn prefers_akamai_grn_over_generated() {
        let response = app()
            .oneshot(
                axum::http::Request::get("/")
                    .header("akamai-grn", "0.abc.123")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.headers().get(REQUEST_ID_HEADER).unwrap(),
            "0.abc.123"
        );
    }

    #[tokio::test]
    async fn rejects_bodies_over_the_hard_ceiling() {
        let app = with_middleware(
            Router::new().route(
                "/",
                axum::routing::post(
                    |body: axum::body::Bytes| async move { body.len().to_string() },
                )
                .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_LIMIT * 2)),
            ),
            Duration::from_secs(5),
        );
        let big = vec![b'x'; MAX_BODY_LIMIT + 1];
        let response = app
            .oneshot(
                axum::http::Request::post("/")
                    .header("content-length", big.len())
                    .body(Body::from(big))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn rejects_oversized_bodies() {
        let big = vec![b'x'; DEFAULT_BODY_LIMIT + 1];
        let response = app()
            .oneshot(
                axum::http::Request::post("/")
                    .body(Body::from(big))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::PAYLOAD_TOO_LARGE);
    }
}
