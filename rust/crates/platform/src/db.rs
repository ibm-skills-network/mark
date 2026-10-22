//! PostgreSQL connectivity.
//!
//! The pool connects lazily so a process can start, report itself alive, and
//! report itself *not ready* while the database is unreachable, instead of
//! crash-looping. Readiness pings the pool with a bounded timeout.
//!
//! `DATABASE_URL` in the cluster goes through pgbouncer in transaction pool
//! mode. Two consequences shape this module:
//!
//! * Nothing here may issue session-level `SET`, `PREPARE`, `LISTEN`, or
//!   advisory locks; they would leak into connections the legacy app shares.
//! * Named prepared statements are only safe with pgbouncer 1.21+ and
//!   `max_prepared_statements` configured. Until that is verified on the live
//!   pooler, the statement cache is disabled so sqlx uses unnamed statements.

use std::str::FromStr;
use std::time::{Duration, Instant};

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use tracing::{debug, warn};

use crate::config::Config;

/// Build a lazily connecting pool from configuration.
pub fn pool(config: &Config) -> anyhow::Result<PgPool> {
    let options = PgConnectOptions::from_str(&config.database_url)
        .map_err(|e| anyhow::anyhow!("DATABASE_URL is not a valid PostgreSQL URL: {e}"))?
        .application_name(&config.service_name)
        .statement_cache_capacity(0);

    let pool = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .acquire_timeout(config.database_connect_timeout)
        .connect_lazy_with(options);
    Ok(pool)
}

/// Round-trip a trivial query. Used by readiness; bounded by `timeout`.
pub async fn ping(pool: &PgPool, timeout: Duration) -> Result<Duration, PingError> {
    let started = Instant::now();
    let query = sqlx::query("SELECT 1").persistent(false).execute(pool);
    match tokio::time::timeout(timeout, query).await {
        Ok(Ok(_)) => {
            let elapsed = started.elapsed();
            debug!(latency_ms = crate::millis(elapsed), "database ping ok");
            Ok(elapsed)
        }
        Ok(Err(error)) => {
            warn!(%error, "database ping failed");
            Err(PingError::Query(error.to_string()))
        }
        Err(_) => {
            warn!(
                timeout_ms = crate::millis(timeout),
                "database ping timed out"
            );
            Err(PingError::Timeout(timeout))
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PingError {
    #[error("query failed: {0}")]
    Query(String),
    #[error("timed out after {0:?}")]
    Timeout(Duration),
}
