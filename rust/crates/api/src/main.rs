//! Mark Rust API process.
//!
//! Serves health endpoints and the learner routes under `/api/v2`. Learner
//! writes are mounted behind the `accept_operations` control so a dark
//! deployment cannot take writes; the submit also needs the internal grading
//! API (`MARK_INTERNAL_API_URL`, `JOB_QUEUE_SECRET`).

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

    let grading = &config.grading;
    if config.controls.accept_operations {
        if !grading.internal_api_configured() {
            warn!("MARK_INTERNAL_API_URL or JOB_QUEUE_SECRET is not set; learner submits will answer 503");
        }
        if grading.lti_gateway_url.is_none() {
            warn!("GRADING_LTI_GATEWAY_URL is not set; LTI grade passback will be scheduled for retry, never sent");
        }
        if grading.learner_buckets().is_empty() {
            warn!("no learner upload bucket is configured; submits with files will be refused");
        }
    }
    let submit = mark_learner::SubmitSettings::new(
        grading
            .internal_api_url
            .as_deref()
            .zip(grading.job_queue_secret.clone()),
        grading.internal_contract_min,
        grading.lti_gateway_url.clone(),
        grading.learner_buckets(),
    )?;
    let learner = mark_learner::router(mark_learner::LearnerState {
        pool: pool.clone(),
        accept_operations: config.controls.accept_operations,
        submit,
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
