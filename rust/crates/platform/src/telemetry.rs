//! Structured logging and tracing.
//!
//! Every process emits one span per request or job with the request ID,
//! service name, role, and build SHA attached, so a single incident can be
//! followed across the gateway, the legacy API, and the Rust processes.
//! OpenTelemetry export is a later addition; the subscriber shape is chosen so
//! an OTLP layer can be appended without changing call sites.

use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::build_info::BUILD;
use crate::config::{Config, LogFormat};

/// Install the global subscriber. Returns an error if one is already set.
pub fn init(config: &Config) -> anyhow::Result<()> {
    let filter = EnvFilter::try_new(&config.log_filter)
        .map_err(|e| anyhow::anyhow!("invalid RUST_LOG filter {:?}: {e}", config.log_filter))?;

    let registry = tracing_subscriber::registry().with(filter);
    match config.log_format {
        LogFormat::Json => registry
            .with(
                fmt::layer()
                    .json()
                    .flatten_event(true)
                    .with_current_span(true)
                    .with_span_list(false)
                    .with_target(true),
            )
            .try_init()?,
        LogFormat::Pretty => registry.with(fmt::layer().pretty()).try_init()?,
    }

    tracing::info!(
        service = %config.service_name,
        role = %config.role,
        build_sha = BUILD.git_sha,
        build_ref = BUILD.git_ref,
        version = BUILD.crate_version,
        "telemetry initialised"
    );
    Ok(())
}
