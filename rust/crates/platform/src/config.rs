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
    pub grading: GradingHandOff,
    pub worker: WorkerSettings,
}

/// How much work one worker process takes on. Read only for
/// [`Role::Worker`]; the API keeps the defaults so a stray worker variable
/// in its environment cannot stop it from starting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerSettings {
    /// `MARK_RUST_WORKER_CREDITS`: memory budget, as the sum of the `cost`
    /// of the operations running at once.
    pub credits: u32,
    /// `MARK_RUST_WORKER_KINDS`: restrict claiming to these operation kinds.
    /// `None` claims every kind the process has a handler for.
    pub kinds: Option<Vec<String>>,
    /// `MARK_RUST_WORKER_LEASE_SECONDS`: how long a claim holds without a
    /// renewal before another worker may take the operation over.
    pub lease: Duration,
}

impl Default for WorkerSettings {
    fn default() -> Self {
        Self {
            credits: 8,
            kinds: None,
            lease: Duration::from_secs(60),
        }
    }
}

/// Upper bound on credits; keeps the value well inside the database's
/// `INTEGER` and rejects typos like an extra zero or two.
const MAX_WORKER_CREDITS: u32 = 1000;
/// Renewal runs every third of the lease, so a lease shorter than this would
/// renew more than once a second.
const MIN_WORKER_LEASE_SECONDS: u64 = 3;

/// Where learner submits go once the API has accepted them: the legacy API's
/// internal grading endpoints (queued tiers), the LTI gateway (grade
/// passback), and the storage buckets learner uploads may name. Every value
/// is optional so a read-only deployment starts without them; the submit
/// route refuses to run when the internal API is not configured.
#[derive(Clone, PartialEq, Eq)]
pub struct GradingHandOff {
    /// `MARK_INTERNAL_API_URL`: base URL of the legacy API service, without
    /// the `/api` prefix (e.g. `http://mark-api:3000`).
    pub internal_api_url: Option<String>,
    /// `JOB_QUEUE_SECRET`: sent as `x-job-queue-secret` to the internal API.
    pub job_queue_secret: Option<String>,
    /// `MARK_INTERNAL_CONTRACT_MIN`: the lowest `x-mark-internal-contract`
    /// the internal API may answer with. A lower or missing value means the
    /// legacy API has not been rolled yet, and submits answer 503 until it is.
    pub internal_contract_min: u32,
    /// `GRADING_LTI_GATEWAY_URL`: where grades are PUT for LTI launches.
    pub lti_gateway_url: Option<String>,
    /// `IBM_COS_LEARNER_BUCKET`.
    pub learner_bucket: Option<String>,
    /// `IBM_COS_LEARNER_BUCKET_PROD`.
    pub learner_bucket_prod: Option<String>,
}

impl Default for GradingHandOff {
    /// Unset hand-off targets, but the contract minimum the current build
    /// needs: a default must never accept an older legacy API.
    fn default() -> Self {
        Self {
            internal_api_url: None,
            job_queue_secret: None,
            internal_contract_min: 1,
            lti_gateway_url: None,
            learner_bucket: None,
            learner_bucket_prod: None,
        }
    }
}

impl GradingHandOff {
    /// Both values the queued hand-off needs are present.
    pub fn internal_api_configured(&self) -> bool {
        self.internal_api_url.is_some() && self.job_queue_secret.is_some()
    }

    /// The configured learner upload buckets, deduplicated.
    pub fn learner_buckets(&self) -> Vec<String> {
        let mut buckets: Vec<String> = Vec::new();
        for bucket in [&self.learner_bucket, &self.learner_bucket_prod]
            .into_iter()
            .flatten()
        {
            if !buckets.contains(bucket) {
                buckets.push(bucket.clone());
            }
        }
        buckets
    }
}

impl fmt::Debug for GradingHandOff {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GradingHandOff")
            .field("internal_api_url", &self.internal_api_url)
            .field(
                "job_queue_secret",
                &self.job_queue_secret.as_ref().map(|_| "<redacted>"),
            )
            .field("internal_contract_min", &self.internal_contract_min)
            .field("lti_gateway_url", &self.lti_gateway_url)
            .field("learner_bucket", &self.learner_bucket)
            .field("learner_bucket_prod", &self.learner_bucket_prod)
            .finish()
    }
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
            .field("grading", &self.grading)
            .field("worker", &self.worker)
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

        let grading = GradingHandOff {
            internal_api_url: http_url(env, "MARK_INTERNAL_API_URL")?
                .map(|url| url.trim_end_matches('/').to_owned()),
            job_queue_secret: env.get("JOB_QUEUE_SECRET"),
            internal_contract_min: parse_or(env, "MARK_INTERNAL_CONTRACT_MIN", 1)?,
            lti_gateway_url: http_url(env, "GRADING_LTI_GATEWAY_URL")?,
            learner_bucket: env.get("IBM_COS_LEARNER_BUCKET"),
            learner_bucket_prod: env.get("IBM_COS_LEARNER_BUCKET_PROD"),
        };

        let worker = match role {
            Role::Worker => worker_settings(env)?,
            Role::Api => WorkerSettings::default(),
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
            grading,
            worker,
        })
    }
}

fn worker_settings(env: &impl Source) -> Result<WorkerSettings, ConfigError> {
    let defaults = WorkerSettings::default();
    let credits = parse_or(env, "MARK_RUST_WORKER_CREDITS", defaults.credits)?;
    if credits == 0 || credits > MAX_WORKER_CREDITS {
        return Err(ConfigError::Invalid {
            name: "MARK_RUST_WORKER_CREDITS",
            reason: format!("expected 1..={MAX_WORKER_CREDITS}, got {credits}"),
        });
    }
    let lease_seconds = parse_or(
        env,
        "MARK_RUST_WORKER_LEASE_SECONDS",
        defaults.lease.as_secs(),
    )?;
    if lease_seconds < MIN_WORKER_LEASE_SECONDS {
        return Err(ConfigError::Invalid {
            name: "MARK_RUST_WORKER_LEASE_SECONDS",
            reason: format!("expected at least {MIN_WORKER_LEASE_SECONDS}, got {lease_seconds}"),
        });
    }
    Ok(WorkerSettings {
        credits,
        kinds: worker_kinds(env)?,
        lease: Duration::from_secs(lease_seconds),
    })
}

/// A comma-separated kind list. A value that lists nothing, or a token with
/// characters no kind uses, is an error: a typo here must not silently widen
/// or empty what the worker claims.
fn worker_kinds(env: &impl Source) -> Result<Option<Vec<String>>, ConfigError> {
    const NAME: &str = "MARK_RUST_WORKER_KINDS";
    let Some(raw) = env.get(NAME) else {
        return Ok(None);
    };
    let mut kinds: Vec<String> = Vec::new();
    for token in raw.split(',').map(str::trim).filter(|t| !t.is_empty()) {
        let valid = token
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'));
        if !valid {
            return Err(ConfigError::Invalid {
                name: NAME,
                reason: format!("invalid kind {token:?}"),
            });
        }
        if !kinds.iter().any(|k| k == token) {
            kinds.push(token.to_owned());
        }
    }
    if kinds.is_empty() {
        return Err(ConfigError::Invalid {
            name: NAME,
            reason: "no kinds listed".to_owned(),
        });
    }
    Ok(Some(kinds))
}

/// An optional `http://` or `https://` URL. Anything else is a startup error
/// rather than a request-time surprise.
fn http_url(env: &impl Source, name: &'static str) -> Result<Option<String>, ConfigError> {
    match env.get(name) {
        None => Ok(None),
        Some(raw) => {
            let lower = raw.to_ascii_lowercase();
            if (lower.starts_with("http://") || lower.starts_with("https://"))
                && raw.len() > "https://".len()
                && !raw.chars().any(char::is_whitespace)
            {
                Ok(Some(raw))
            } else {
                Err(ConfigError::Invalid {
                    name,
                    reason: "expected an http:// or https:// URL".to_owned(),
                })
            }
        }
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
    fn grading_hand_off_is_optional_and_validated() {
        let cfg = Config::load(Role::Api, &base()).unwrap();
        assert_eq!(cfg.grading, GradingHandOff::default());
        assert!(!cfg.grading.internal_api_configured());
        assert!(cfg.grading.learner_buckets().is_empty());

        let mut env = base();
        env.insert("MARK_INTERNAL_API_URL", "http://mark-api:3000/");
        env.insert("JOB_QUEUE_SECRET", "s3cr3t-value"); // pragma: allowlist secret
        env.insert("GRADING_LTI_GATEWAY_URL", "https://lti.example/grade");
        env.insert("IBM_COS_LEARNER_BUCKET", "learner");
        env.insert("IBM_COS_LEARNER_BUCKET_PROD", "learner");
        let cfg = Config::load(Role::Api, &env).unwrap();
        assert_eq!(
            cfg.grading.internal_api_url.as_deref(),
            Some("http://mark-api:3000")
        );
        assert!(cfg.grading.internal_api_configured());
        assert_eq!(cfg.grading.internal_contract_min, 1);
        assert_eq!(cfg.grading.learner_buckets(), vec!["learner".to_owned()]);
        env.insert("MARK_INTERNAL_CONTRACT_MIN", "2");
        assert_eq!(
            Config::load(Role::Api, &env)
                .unwrap()
                .grading
                .internal_contract_min,
            2
        );
        env.insert("MARK_INTERNAL_CONTRACT_MIN", "one");
        assert!(matches!(
            Config::load(Role::Api, &env),
            Err(ConfigError::Invalid {
                name: "MARK_INTERNAL_CONTRACT_MIN",
                ..
            })
        ));
        env.insert("MARK_INTERNAL_CONTRACT_MIN", "1");
        let rendered = format!("{cfg:?}");
        assert!(!rendered.contains("s3cr3t-value"), "{rendered}");

        env.insert("MARK_INTERNAL_API_URL", "mark-api:3000");
        assert!(matches!(
            Config::load(Role::Api, &env),
            Err(ConfigError::Invalid {
                name: "MARK_INTERNAL_API_URL",
                ..
            })
        ));
    }

    #[test]
    fn worker_settings_default_and_parse() {
        let cfg = Config::load(Role::Worker, &base()).unwrap();
        assert_eq!(cfg.worker, WorkerSettings::default());
        assert_eq!(cfg.worker.credits, 8);
        assert_eq!(cfg.worker.kinds, None);
        assert_eq!(cfg.worker.lease, Duration::from_secs(60));

        let mut env = base();
        env.insert("MARK_RUST_WORKER_CREDITS", "12");
        env.insert(
            "MARK_RUST_WORKER_KINDS",
            " grading.heavy, translate.meta ,,grading.heavy",
        );
        env.insert("MARK_RUST_WORKER_LEASE_SECONDS", "90");
        let cfg = Config::load(Role::Worker, &env).unwrap();
        assert_eq!(cfg.worker.credits, 12);
        assert_eq!(
            cfg.worker.kinds,
            Some(vec![
                "grading.heavy".to_owned(),
                "translate.meta".to_owned()
            ])
        );
        assert_eq!(cfg.worker.lease, Duration::from_secs(90));
    }

    #[test]
    fn worker_settings_are_validated() {
        for (name, value) in [
            ("MARK_RUST_WORKER_CREDITS", "0"),
            ("MARK_RUST_WORKER_CREDITS", "eight"),
            ("MARK_RUST_WORKER_CREDITS", "80000"),
            ("MARK_RUST_WORKER_LEASE_SECONDS", "2"),
            ("MARK_RUST_WORKER_LEASE_SECONDS", "-5"),
            ("MARK_RUST_WORKER_KINDS", " , ,"),
            ("MARK_RUST_WORKER_KINDS", "grading.heavy,Grading Standard"),
        ] {
            let mut env = base();
            env.insert(name, value);
            match Config::load(Role::Worker, &env) {
                Err(ConfigError::Invalid { name: got, .. }) => assert_eq!(got, name, "{value}"),
                other => panic!("{name}={value}: expected Invalid, got {other:?}"),
            }
        }
    }

    #[test]
    fn worker_settings_are_ignored_by_the_api() {
        let mut env = base();
        env.insert("MARK_RUST_WORKER_CREDITS", "0");
        env.insert("MARK_RUST_WORKER_KINDS", "Not Valid");
        let cfg = Config::load(Role::Api, &env).unwrap();
        assert_eq!(cfg.worker, WorkerSettings::default());
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
