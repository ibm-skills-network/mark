//! Process configuration.
//!
//! Configuration is read from the environment once at startup and validated
//! up front so a misconfigured process fails before it binds a port. Values
//! are read through a [`Source`] so tests can supply them without touching
//! the real process environment.

use std::collections::HashMap;
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use thiserror::Error;

/// Which role this process plays. Both roles share the same configuration
/// surface; the role only changes defaults and which switches are relevant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Api,
    Worker,
}

impl Role {
    fn default_port(self) -> u16 {
        match self {
            Role::Api => 8080,
            Role::Worker => 8081,
        }
    }

    pub fn service_name(self) -> &'static str {
        match self {
            Role::Api => "mark-rust-api",
            Role::Worker => "mark-rust-worker",
        }
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Role::Api => "api",
            Role::Worker => "worker",
        })
    }
}

/// Log output format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LogFormat {
    /// One JSON object per line, for the cluster log pipeline.
    #[default]
    Json,
    /// Human-readable output for local development.
    Pretty,
}

/// The three switches that decide whether this deployment does any
/// authoritative work. They are independent on purpose: a dark deployment
/// runs with all three off, a canary enables them one at a time, and a
/// rollback turns them off in the reverse order without redeploying.
///
/// Every switch defaults to **off**. A freshly deployed process must never
/// pick up production work because an environment variable was forgotten.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ExecutionControls {
    /// The API may accept new operations (writes) for cohorts it owns.
    pub accept_operations: bool,
    /// The worker may claim and execute durable operations.
    pub consume_work: bool,
    /// Completed work may dispatch external effects (LMS delivery, email,
    /// support tickets, provider calls with side effects).
    pub dispatch_external_effects: bool,
}

impl ExecutionControls {
    pub fn all_disabled(self) -> bool {
        !(self.accept_operations || self.consume_work || self.dispatch_external_effects)
    }
}

/// Validated process configuration.
#[derive(Clone)]
pub struct Config {
    pub role: Role,
    pub service_name: String,
    pub bind_addr: SocketAddr,
    pub log_format: LogFormat,
    /// `RUST_LOG`-style filter directive, e.g. `info,sqlx=warn`.
    pub log_filter: String,
    pub database_url: String,
    pub database_max_connections: u32,
    pub database_connect_timeout: Duration,
    pub request_timeout: Duration,
    pub shutdown_grace: Duration,
    pub controls: ExecutionControls,
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("role", &self.role)
            .field("service_name", &self.service_name)
            .field("bind_addr", &self.bind_addr)
            .field("log_format", &self.log_format)
            .field("log_filter", &self.log_filter)
            .field("database_url", &"<redacted>")
            .field("database_max_connections", &self.database_max_connections)
            .field("database_connect_timeout", &self.database_connect_timeout)
            .field("request_timeout", &self.request_timeout)
            .field("shutdown_grace", &self.shutdown_grace)
            .field("controls", &self.controls)
            .finish()
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("invalid value for {name}: {reason}")]
    Invalid { name: &'static str, reason: String },
}

/// A read-only view of environment variables.
pub trait Source {
    fn get(&self, key: &str) -> Option<String>;
}

/// The real process environment.
#[derive(Debug, Default, Clone, Copy)]
pub struct ProcessEnv;

impl Source for ProcessEnv {
    fn get(&self, key: &str) -> Option<String> {
        std::env::var(key).ok().filter(|v| !v.is_empty())
    }
}

impl<S: std::hash::BuildHasher> Source for HashMap<&'static str, &'static str, S> {
    fn get(&self, key: &str) -> Option<String> {
        HashMap::get(self, key)
            .map(|v| (*v).to_owned())
            .filter(|v| !v.is_empty())
    }
}

impl Config {
    /// Load configuration for `role` from the process environment.
    pub fn from_env(role: Role) -> Result<Self, ConfigError> {
        Self::load(role, &ProcessEnv)
    }

    /// Load configuration for `role` from an arbitrary source.
    pub fn load(role: Role, env: &impl Source) -> Result<Self, ConfigError> {
        let port = parse_or(env, "PORT", role.default_port())?;
        let host = match env.get("HOST") {
            Some(raw) => raw.parse::<IpAddr>().map_err(|e| ConfigError::Invalid {
                name: "HOST",
                reason: e.to_string(),
            })?,
            None => IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        };

        let log_format = match env.get("LOG_FORMAT").as_deref() {
            None | Some("json") => LogFormat::Json,
            Some("pretty") => LogFormat::Pretty,
            Some(other) => {
                return Err(ConfigError::Invalid {
                    name: "LOG_FORMAT",
                    reason: format!("expected json or pretty, got {other}"),
                })
            }
        };

        let database_url = env
            .get("DATABASE_URL")
            .ok_or(ConfigError::Missing("DATABASE_URL"))?;

        let controls = ExecutionControls {
            accept_operations: parse_bool(env, "MARK_RUST_ACCEPT_OPERATIONS")?,
            consume_work: parse_bool(env, "MARK_RUST_CONSUME_WORK")?,
            dispatch_external_effects: parse_bool(env, "MARK_RUST_DISPATCH_EXTERNAL_EFFECTS")?,
        };

        Ok(Self {
            role,
            service_name: env
                .get("SERVICE_NAME")
                .unwrap_or_else(|| role.service_name().to_owned()),
            bind_addr: SocketAddr::new(host, port),
            log_format,
            log_filter: env.get("RUST_LOG").unwrap_or_else(|| "info".to_owned()),
            database_url,
            database_max_connections: parse_or(env, "DATABASE_MAX_CONNECTIONS", 5)?,
            database_connect_timeout: Duration::from_millis(parse_or(
                env,
                "DATABASE_CONNECT_TIMEOUT_MS",
                5000,
            )?),
            request_timeout: Duration::from_millis(parse_or(env, "REQUEST_TIMEOUT_MS", 30_000)?),
            shutdown_grace: Duration::from_millis(parse_or(env, "SHUTDOWN_GRACE_MS", 20_000)?),
            controls,
        })
    }
}

fn parse_or<T>(env: &impl Source, name: &'static str, default: T) -> Result<T, ConfigError>
where
    T: std::str::FromStr,
    T::Err: fmt::Display,
{
    match env.get(name) {
        None => Ok(default),
        Some(raw) => raw.parse::<T>().map_err(|e| ConfigError::Invalid {
            name,
            reason: e.to_string(),
        }),
    }
}

/// Booleans accept only `true`/`false` (case-insensitive) and `1`/`0`.
/// Anything else is an error rather than a silent `false`, because a typo in
/// a switch name or value must be visible, not quietly conservative.
fn parse_bool(env: &impl Source, name: &'static str) -> Result<bool, ConfigError> {
    match env
        .get(name)
        .as_deref()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("true" | "1") => Ok(true),
        None | Some("false" | "0") => Ok(false),
        Some(other) => Err(ConfigError::Invalid {
            name,
            reason: format!("expected true or false, got {other}"),
        }),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn base() -> HashMap<&'static str, &'static str> {
        HashMap::from([("DATABASE_URL", "postgres://example")])
    }

    #[test]
    fn defaults_are_conservative() {
        let cfg = Config::load(Role::Api, &base()).unwrap();
        assert_eq!(cfg.bind_addr.port(), 8080);
        assert_eq!(cfg.log_format, LogFormat::Json);
        assert!(cfg.controls.all_disabled());
        assert_eq!(cfg.service_name, "mark-rust-api");

        let worker = Config::load(Role::Worker, &base()).unwrap();
        assert_eq!(worker.bind_addr.port(), 8081);
        assert_eq!(worker.service_name, "mark-rust-worker");
    }

    #[test]
    fn database_url_is_required() {
        let err = Config::load(Role::Api, &HashMap::new()).unwrap_err();
        assert!(matches!(err, ConfigError::Missing("DATABASE_URL")));
    }

    #[test]
    fn switches_parse_strictly() {
        let mut env = base();
        env.insert("MARK_RUST_CONSUME_WORK", "TRUE");
        env.insert("MARK_RUST_ACCEPT_OPERATIONS", "0");
        let cfg = Config::load(Role::Worker, &env).unwrap();
        assert!(cfg.controls.consume_work);
        assert!(!cfg.controls.accept_operations);
        assert!(!cfg.controls.dispatch_external_effects);

        env.insert("MARK_RUST_DISPATCH_EXTERNAL_EFFECTS", "yes");
        let err = Config::load(Role::Worker, &env).unwrap_err();
        assert!(matches!(
            err,
            ConfigError::Invalid {
                name: "MARK_RUST_DISPATCH_EXTERNAL_EFFECTS",
                ..
            }
        ));
    }

    #[test]
    fn invalid_port_and_format_are_rejected() {
        let mut env = base();
        env.insert("PORT", "http");
        assert!(matches!(
            Config::load(Role::Api, &env),
            Err(ConfigError::Invalid { name: "PORT", .. })
        ));

        let mut env = base();
        env.insert("LOG_FORMAT", "xml");
        assert!(matches!(
            Config::load(Role::Api, &env),
            Err(ConfigError::Invalid {
                name: "LOG_FORMAT",
                ..
            })
        ));
    }

    #[test]
    fn empty_values_count_as_unset() {
        let mut env = base();
        env.insert("PORT", "");
        env.insert("LOG_FORMAT", "");
        let cfg = Config::load(Role::Api, &env).unwrap();
        assert_eq!(cfg.bind_addr.port(), 8080);
        assert_eq!(cfg.log_format, LogFormat::Json);
    }

    #[test]
    fn debug_output_redacts_database_url() {
        let mut env = base();
        env.insert("DATABASE_URL", "postgres://user:hunter2@db/mark"); // pragma: allowlist secret
        let cfg = Config::load(Role::Api, &env).unwrap();
        let rendered = format!("{cfg:?}");
        assert!(!rendered.contains("hunter2"));
        assert!(rendered.contains("<redacted>"));
    }
}
