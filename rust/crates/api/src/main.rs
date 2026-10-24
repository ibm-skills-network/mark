//! Mark Rust API process.
//!
//! Serves health endpoints and the learner assignment-load routes under
//! `/api/v2`. Learner writes are mounted behind the `accept_operations`
//! control so a dark deployment cannot take writes.

use std::time::Duration;

use axum::Router;
use mark_platform::health::{DatabaseProbe, HealthState};
use mark_platform::{db, http, telemetry, Config, Role};
use tracing::{info, warn};

fn main() -> anyhow::Result<()> {
    let config = Config::from_env(Role::Api)?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run(config))
}

async fn run(config: Config) -> anyhow::Result<()> {
    telemetry::init(&config)?;
    info!(?config, "starting api");

    if !config.controls.all_disabled() {
        warn!(controls = ?config.controls, "execution controls enabled; this process may take authoritative work");
    }

    let pool = db::pool(&config)?;
    let health = HealthState::new(config.role, config.service_name.clone(), config.controls)
        .with_probe(DatabaseProbe::new(pool.clone(), Duration::from_secs(2)));

    let learner = mark_learner::router(mark_learner::LearnerState {
        pool: pool.clone(),
        accept_operations: config.controls.accept_operations,
    });
    let router = http::with_middleware(
        Router::new()
            .merge(health.router())
            .nest("/api/v2", learner),
        config.request_timeout,
    );

    http::serve(router, config.bind_addr, config.shutdown_grace).await?;
    pool.close().await;
    info!("api stopped");
    Ok(())
}
