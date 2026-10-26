//! Mark Rust worker process.
//!
//! Foundation release: exposes health probes and idles. It claims no work
//! unless `MARK_RUST_CONSUME_WORK=true`, and even then there is nothing to
//! claim yet; the durable operation store arrives with the first workflow.
//! The point of shipping the idle loop now is to prove the deployment path,
//! probes, shutdown, and the control switches before any work exists.

use std::time::Duration;

use axum::Router;
use mark_platform::health::{DatabaseProbe, HealthState};
use mark_platform::{db, http, shutdown, telemetry, Config, Role};
use tracing::{debug, info, warn};

const IDLE_HEARTBEAT: Duration = Duration::from_secs(60);

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

    if config.controls.consume_work {
        warn!("consume_work is enabled but no operation types are registered; idling");
    } else {
        info!("consume_work is disabled; worker will not claim operations");
    }

    let idle = async {
        let mut tick = tokio::time::interval(IDLE_HEARTBEAT);
        loop {
            tick.tick().await;
            debug!(
                consume_work = config.controls.consume_work,
                "worker heartbeat"
            );
        }
    };

    tokio::select! {
        () = idle => {}
        () = shutdown::signal() => info!("worker loop stopping"),
    }

    probes.await??;
    pool.close().await;
    info!("worker stopped");
    Ok(())
}
