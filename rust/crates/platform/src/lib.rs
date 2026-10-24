//! Shared runtime foundation for Mark's Rust processes.
//!
//! This crate owns the pieces every process needs before it can do any
//! business work: configuration loading, structured telemetry, health
//! endpoints, database connectivity, and coordinated shutdown. It deliberately
//! contains no assessment domain logic; that arrives with the first migrated
//! workflow in its own crates.

pub mod build_info;
pub mod config;
pub mod db;
pub mod health;
pub mod http;
pub mod shutdown;
pub mod telemetry;

pub use config::{Config, ConfigError, ExecutionControls, LogFormat, Role};

/// Milliseconds as a `u64` so tracing records a number, not a string.
/// Saturates on absurd values rather than panicking in a log call.
pub(crate) fn millis(d: std::time::Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}
