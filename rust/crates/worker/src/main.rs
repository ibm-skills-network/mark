//! Mark Rust worker process.
//!
//! Serves health probes and runs the operation loop. It claims nothing
//! unless `MARK_RUST_CONSUME_WORK=true`, and with no handlers registered it
//! only polls and reaps: the loop, leases and switches go live before any
//! job family moves over.

use std::time::Duration;

use axum::Router;
use mark_ops::worker::{self, Registry, WorkerConfig};
use mark_platform::health::{DatabaseProbe, HealthState};
use mark_platform::{db, http, shutdown, telemetry, Config, Role};
use tracing::info;

fn main() -> anyhow::Result<()> {
    let config = Config::from_env(Role::Worker)?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run(config))
}

async fn run(config: Config) -> anyhow::Result<()> {
    telemetry::init(&config)?;
    info!(?config, "starting worker");

    let pool = db::pool(&config)?;
    let health = HealthState::new(config.role, config.service_name.clone(), config.controls)
        .with_probe(DatabaseProbe::new(pool.clone(), Duration::from_secs(2)));
    let router =
        http::with_middleware(Router::new().merge(health.router()), config.request_timeout);

    let probes = tokio::spawn(http::serve(router, config.bind_addr, config.shutdown_grace));

    let worker_config = WorkerConfig::from_config(&config)?;
    let registry = Registry::new();
    let outcome = worker::run(pool.clone(), registry, worker_config, shutdown::signal()).await;

    // Let the probe server finish draining even if the loop failed.
    probes.await??;
    outcome?;
    pool.close().await;
    info!("worker stopped");
    Ok(())
}
