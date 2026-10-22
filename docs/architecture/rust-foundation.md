# Rust backend foundation

The Rust backend lives in `rust/` as a Cargo workspace beside the existing
Yarn/Turborepo apps. It is migrated into capability by capability (see the
[master plan](rust-migration-master-plan.md)); this document covers what the
foundation ships and how to run it.

## What exists

| Crate                   | Binary        | Purpose                                                                 |
| ----------------------- | ------------- | ----------------------------------------------------------------------- |
| `rust/crates/platform`  | —             | Config, telemetry, health probes, PostgreSQL pool, HTTP middleware, shutdown |
| `rust/crates/api`       | `mark-api`    | HTTP process. Foundation release serves health only                      |
| `rust/crates/worker`    | `mark-worker` | Background process. Foundation release idles and serves health probes    |

Domain, application, and infrastructure crates are added with the first
migrated workflow, not in advance.

Both binaries expose:

- `GET /health/liveness` — 200 while the process can serve HTTP. Never
  consults dependencies.
- `GET /health/readiness` — 200 when every registered probe passes, 503
  otherwise. The body lists each probe, its latency, and the three execution
  switches, so an operator can confirm a pod is dark.

Every request carries an `x-request-id`. An upstream `x-request-id` or
`akamai-grn` is preserved; otherwise one is generated. Logs are JSON with the
request ID, service, role, and build SHA on each line.

## Configuration

All configuration is environment variables, read once at startup. A missing
required value or an unparseable value stops the process before it binds.

| Variable                             | Default                  | Notes                                                        |
| ------------------------------------ | ------------------------ | ------------------------------------------------------------ |
| `DATABASE_URL`                       | required                 | Same pgbouncer URL the legacy API uses                       |
| `PORT`                               | api 8080, worker 8081    |                                                              |
| `HOST`                               | 0.0.0.0                  |                                                              |
| `LOG_FORMAT`                         | `json`                   | `pretty` for local development                               |
| `RUST_LOG`                           | `info`                   | Standard `tracing` filter, e.g. `info,sqlx=warn`             |
| `SERVICE_NAME`                       | `mark-rust-api`/`-worker`|                                                              |
| `DATABASE_MAX_CONNECTIONS`           | 5                        |                                                              |
| `DATABASE_CONNECT_TIMEOUT_MS`        | 5000                     |                                                              |
| `REQUEST_TIMEOUT_MS`                 | 30000                    | Responds 504 when exceeded                                   |
| `SHUTDOWN_GRACE_MS`                  | 20000                    | In-flight requests get this long after SIGTERM               |
| `MARK_RUST_ACCEPT_OPERATIONS`        | `false`                  | API may accept writes for cohorts it owns                    |
| `MARK_RUST_CONSUME_WORK`             | `false`                  | Worker may claim durable operations                          |
| `MARK_RUST_DISPATCH_EXTERNAL_EFFECTS`| `false`                  | Completed work may call LMS, email, support, providers       |

Switches accept only `true`/`false`/`1`/`0`. Any other value is a startup
error rather than a silent `false`, so a typo cannot pass for a deliberate
setting.

### The three switches

A dark deployment runs with all three off. They are separate because rollout
and rollback enable them one at a time in opposite orders, and because
traffic routing alone never stops a worker from consuming shared work. Nothing
in the foundation honours them yet beyond reporting them; migrated workflows
must check the relevant switch before doing authoritative work.

## Running locally

Requirements: [rustup](https://rustup.rs). The toolchain is pinned in
`rust-toolchain.toml`; rustup installs it on first use. On macOS with a
Homebrew `cargo` on `PATH`, put `~/.cargo/bin` first so the pin applies.

```sh
yarn db                      # existing local Postgres on :6001
cd rust
DATABASE_URL=postgres://mark-pg-user:mysecretpassword@localhost:6001/mark-pg \
LOG_FORMAT=pretty cargo run --bin mark-api
curl -s localhost:8080/health/readiness | jq
```

Checks, same as CI:

```sh
yarn check:rust              # fmt --check, clippy -D warnings, test, build
```

Database-backed tests run only when `DATABASE_URL` is set and skip otherwise.

## Container image

`rust/Dockerfile` builds one binary per image via `--build-arg BIN=mark-api`
or `BIN=mark-worker`. Images are published as `mark-rust-api` and
`mark-rust-worker` with the same tag scheme as the other services. The build
stamps `MARK_BUILD_SHA` and `MARK_BUILD_REF` into the binary; both appear in
the health responses and in every log line.

## Deployment

`helm-chart/mark` has `rustApi` and `rustWorker` sections, both
`enabled: false`. Environment overlays live in the deploy repository. The
first staging deployment keeps all three switches off and verifies:

1. readiness is 200 through the pooler,
2. logs arrive in the cluster log pipeline with request IDs,
3. the worker logs that consumption is disabled and claims nothing.

## Constraints carried over from the legacy stack

- `DATABASE_URL` goes through pgbouncer in transaction pool mode. Rust code
  must never issue session-level `SET`, `PREPARE`, `LISTEN`, temp tables, or
  advisory locks; use `SET LOCAL` inside a transaction.
- sqlx's statement cache is disabled (`statement_cache_capacity(0)`) until
  the pooler's `max_prepared_statements` support is verified. Revisit once
  confirmed; it is a measurable throughput cost on hot queries.
- The Prisma migration history stays the single schema owner. Rust reads and
  writes the existing schema and does not run its own migrations.

## Open items before the first workflow

- Verify pgbouncer version and prepared-statement support on staging.
- OpenTelemetry export, once the telemetry backend's OTLP endpoint is
  confirmed.
- Durable operation store and the worker claim loop.
- Mixed-mode `dev` command that starts the Rust processes beside the legacy
  stack.
