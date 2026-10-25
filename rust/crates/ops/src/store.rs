//! Every statement against `operation`, `operation_event` and
//! `operation_outbox`, one function each.
//!
//! pgbouncer transaction pooling rules apply (see `platform::db`): unnamed
//! statements only (`persistent(false)`), no session state, no `LISTEN`, no
//! advisory locks. Callers pass a connection that is inside an explicit
//! transaction, because an unnamed statement with binds is two round trips
//! and only an open transaction keeps pgbouncer on one server connection.
//! [`Store::enqueue`] is the only function that runs more than one
//! statement, and it does so in a savepoint of the caller's transaction.
//!
//! Handler writes are fenced on `(id, lease_owner, state = 'leased')`, where
//! `lease_owner` is a token minted per claim, so a run whose lease was taken
//! over (even by the same process) cannot overwrite the new claim's work.

use std::fmt;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::postgres::{PgArguments, PgRow};
use sqlx::{Acquire, PgConnection, Postgres, Row};
use uuid::Uuid;

type Result<T> = std::result::Result<T, sqlx::Error>;

fn q(sql: &'static str) -> sqlx::query::Query<'static, Postgres, PgArguments> {
    sqlx::query(sql).persistent(false)
}

/// Durations go over the wire as whole milliseconds and are turned into an
/// interval in SQL, which avoids depending on an interval codec.
fn millis(d: Duration) -> i64 {
    i64::try_from(d.as_millis()).unwrap_or(i64::MAX)
}

/// Lifecycle of an operation row; mirrors `operation_state_check`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum State {
    Queued,
    Leased,
    Succeeded,
    /// Reserved: retries go straight back to `Queued`, so one claim
    /// predicate covers both new and retried work.
    Failed,
    Dead,
    Cancelled,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            State::Queued => "queued",
            State::Leased => "leased",
            State::Succeeded => "succeeded",
            State::Failed => "failed",
            State::Dead => "dead",
            State::Cancelled => "cancelled",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Some(match raw {
            "queued" => State::Queued,
            "leased" => State::Leased,
            "succeeded" => State::Succeeded,
            "failed" => State::Failed,
            "dead" => State::Dead,
            "cancelled" => State::Cancelled,
            _ => return None,
        })
    }
}

impl fmt::Display for State {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Lifecycle of an outbox row; mirrors `operation_outbox_state_check`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OutboxState {
    Pending,
    Leased,
    Sent,
    Dead,
}

impl OutboxState {
    pub fn as_str(self) -> &'static str {
        match self {
            OutboxState::Pending => "pending",
            OutboxState::Leased => "leased",
            OutboxState::Sent => "sent",
            OutboxState::Dead => "dead",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Some(match raw {
            "pending" => OutboxState::Pending,
            "leased" => OutboxState::Leased,
            "sent" => OutboxState::Sent,
            "dead" => OutboxState::Dead,
            _ => return None,
        })
    }
}

impl fmt::Display for OutboxState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A value the check constraint should have made impossible.
fn decode_error(column: &str, raw: &str) -> sqlx::Error {
    sqlx::Error::ColumnDecode {
        index: column.to_owned(),
        source: format!("unexpected state {raw:?}").into(),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Operation {
    pub id: Uuid,
    pub kind: String,
    pub key: String,
    pub payload: Value,
    pub state: State,
    pub attempts: i32,
    pub max_attempts: i32,
    pub cost: i32,
    pub run_after: DateTime<Utc>,
    pub lease_owner: Option<String>,
    pub lease_until: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

fn operation_row(r: &PgRow) -> Result<Operation> {
    let state: String = r.try_get("state")?;
    Ok(Operation {
        id: r.try_get("id")?,
        kind: r.try_get("kind")?,
        key: r.try_get("key")?,
        payload: r.try_get("payload")?,
        state: State::parse(&state).ok_or_else(|| decode_error("state", &state))?,
        attempts: r.try_get("attempts")?,
        max_attempts: r.try_get("max_attempts")?,
        cost: r.try_get("cost")?,
        run_after: r.try_get("run_after")?,
        lease_owner: r.try_get("lease_owner")?,
        lease_until: r.try_get("lease_until")?,
        last_error: r.try_get("last_error")?,
        created_at: r.try_get("created_at")?,
        updated_at: r.try_get("updated_at")?,
        finished_at: r.try_get("finished_at")?,
    })
}

/// What a producer asks for. `None` fields take the column defaults.
#[derive(Debug, Clone, PartialEq)]
pub struct NewOperation {
    pub kind: String,
    pub key: String,
    pub payload: Value,
    pub max_attempts: Option<i32>,
    pub cost: Option<i32>,
    pub run_after: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Enqueued {
    pub id: Uuid,
    /// An in-flight row for `(kind, key)` was already there; nothing new
    /// was inserted and `id` is that row.
    pub existing: bool,
}

/// Result of reporting a failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Back in the queue, claimable from `run_after`.
    Requeued { run_after: DateTime<Utc> },
    /// No more attempts.
    Dead,
    /// The row is not leased by this owner any more; nothing was written.
    LeaseLost,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub id: i64,
    pub operation_id: Uuid,
    pub seq: i32,
    pub at: DateTime<Utc>,
    pub stage: String,
    pub percent: Option<i16>,
    pub message: Option<String>,
    pub data: Option<Value>,
}

fn event_row(r: &PgRow) -> Result<Event> {
    Ok(Event {
        id: r.try_get("id")?,
        operation_id: r.try_get("operation_id")?,
        seq: r.try_get("seq")?,
        at: r.try_get("at")?,
        stage: r.try_get("stage")?,
        percent: r.try_get("percent")?,
        message: r.try_get("message")?,
        data: r.try_get("data")?,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct OutboxItem {
    pub id: Uuid,
    pub operation_id: Option<Uuid>,
    pub kind: String,
    pub payload: Value,
    pub state: OutboxState,
    pub attempts: i32,
    pub max_attempts: i32,
    pub run_after: DateTime<Utc>,
    pub lease_owner: Option<String>,
    pub lease_until: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub sent_at: Option<DateTime<Utc>>,
}

fn outbox_row(r: &PgRow) -> Result<OutboxItem> {
    let state: String = r.try_get("state")?;
    Ok(OutboxItem {
        id: r.try_get("id")?,
        operation_id: r.try_get("operation_id")?,
        kind: r.try_get("kind")?,
        payload: r.try_get("payload")?,
        state: OutboxState::parse(&state).ok_or_else(|| decode_error("state", &state))?,
        attempts: r.try_get("attempts")?,
        max_attempts: r.try_get("max_attempts")?,
        run_after: r.try_get("run_after")?,
        lease_owner: r.try_get("lease_owner")?,
        lease_until: r.try_get("lease_until")?,
        last_error: r.try_get("last_error")?,
        created_at: r.try_get("created_at")?,
        updated_at: r.try_get("updated_at")?,
        sent_at: r.try_get("sent_at")?,
    })
}

fn outcome_row(r: Option<PgRow>, requeued_state: &str) -> Result<Outcome> {
    let Some(r) = r else {
        return Ok(Outcome::LeaseLost);
    };
    let state: String = r.try_get("state")?;
    Ok(if state == requeued_state {
        Outcome::Requeued {
            run_after: r.try_get("run_after")?,
        }
    } else {
        Outcome::Dead
    })
}

macro_rules! sql {
    ($($part:expr),+ $(,)?) => { concat!($($part),+) };
}

/// A macro rather than a const because `concat!` only takes literals.
macro_rules! operation_columns {
    () => {
        "id, kind, key, payload, state, attempts, max_attempts, cost, run_after, lease_owner, lease_until, last_error, created_at, updated_at, finished_at"
    };
}

pub const SQL_ENQUEUE_INSERT: &str = sql!(
    "INSERT INTO operation (kind, key, payload, max_attempts, cost, run_after) ",
    "VALUES ($1, $2, $3, COALESCE($4, 3), COALESCE($5, 1), COALESCE($6, now())) ",
    "ON CONFLICT (kind, key) WHERE state IN ('queued', 'leased') DO NOTHING ",
    "RETURNING id"
);

pub const SQL_ENQUEUE_EXISTING: &str = sql!(
    "SELECT id FROM operation ",
    "WHERE kind = $1 AND key = $2 AND state IN ('queued', 'leased')"
);

/// Locks candidates in order, then keeps the longest prefix whose costs fit
/// the budget, so one claim never takes more credits than it was offered.
/// A head row that does not fit blocks the rest rather than being skipped,
/// so heavy work waits for credits instead of starving. Locked rows that do
/// not fit are released when the transaction ends.
///
/// `lease_owner` is `<$1>/<fresh uuid>` per row: the fence belongs to this
/// claim, so an earlier claim of the same row by the same process cannot
/// pass it.
pub const SQL_CLAIM: &str = sql!(
    "WITH candidate AS (",
    "SELECT id, cost, run_after, created_at FROM operation ",
    "WHERE state = 'queued' AND run_after <= now() AND kind = ANY($3) ",
    "ORDER BY run_after, created_at, id LIMIT $5 FOR UPDATE SKIP LOCKED), ",
    "picked AS (SELECT id FROM (",
    "SELECT id, sum(cost) OVER (ORDER BY run_after, created_at, id) AS total FROM candidate",
    ") c WHERE total <= $4) ",
    "UPDATE operation o SET state = 'leased', lease_owner = $1 || '/' || gen_random_uuid()::text, ",
    "lease_until = now() + $2 * interval '1 millisecond', attempts = o.attempts + 1, updated_at = now() ",
    "FROM picked WHERE o.id = picked.id ",
    "RETURNING o.id, o.kind, o.key, o.payload, o.state, o.attempts, o.max_attempts, o.cost, ",
    "o.run_after, o.lease_owner, o.lease_until, o.last_error, o.created_at, o.updated_at, o.finished_at"
);

pub const SQL_RENEW: &str = sql!(
    "UPDATE operation SET lease_until = now() + $3 * interval '1 millisecond', updated_at = now() ",
    "WHERE id = $1 AND lease_owner = $2 AND state = 'leased'"
);

pub const SQL_SUCCEED: &str = sql!(
    "UPDATE operation SET state = 'succeeded', finished_at = now(), lease_owner = NULL, ",
    "lease_until = NULL, updated_at = now() ",
    "WHERE id = $1 AND lease_owner = $2 AND state = 'leased'"
);

pub const SQL_FAIL: &str = sql!(
    "UPDATE operation SET ",
    "state = CASE WHEN $4::bigint IS NOT NULL AND attempts < max_attempts THEN 'queued' ELSE 'dead' END, ",
    "run_after = CASE WHEN $4::bigint IS NOT NULL AND attempts < max_attempts ",
    "THEN now() + $4::bigint * interval '1 millisecond' ELSE run_after END, ",
    "finished_at = CASE WHEN $4::bigint IS NOT NULL AND attempts < max_attempts THEN NULL ELSE now() END, ",
    "last_error = $3, lease_owner = NULL, lease_until = NULL, updated_at = now() ",
    "WHERE id = $1 AND lease_owner = $2 AND state = 'leased' ",
    "RETURNING state, run_after"
);

pub const SQL_CANCEL: &str = sql!(
    "UPDATE operation SET state = 'cancelled', finished_at = now(), updated_at = now() ",
    "WHERE id = $1 AND state = 'queued'"
);

/// Fenced row lock taken before a progress event: it serializes event
/// writers per operation (so `MAX(seq) + 1` cannot collide) and refuses a
/// writer whose lease is gone.
pub const SQL_EVENT_LOCK: &str = sql!(
    "UPDATE operation SET updated_at = now() ",
    "WHERE id = $1 AND lease_owner = $2 AND state = 'leased'"
);

/// Callers must hold the operation's row lock (see [`SQL_EVENT_LOCK`]).
pub const SQL_EVENT: &str = sql!(
    "INSERT INTO operation_event (operation_id, seq, stage, percent, message, data) ",
    "SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, $4, $5 ",
    "FROM operation_event WHERE operation_id = $1 ",
    "RETURNING seq"
);

pub const SQL_EVENTS: &str = sql!(
    "SELECT id, operation_id, seq, at, stage, percent, message, data FROM operation_event ",
    "WHERE operation_id = $1 AND seq > $2 ORDER BY seq"
);

pub const SQL_GET: &str = sql!(
    "SELECT ",
    operation_columns!(),
    " FROM operation WHERE id = $1"
);

/// Attempts were counted at claim, so an expired lease either goes back to
/// the queue, after a backoff that grows with attempts, or, when the claim
/// was the last attempt, is dead.
pub const SQL_REAP: &str = sql!(
    "UPDATE operation SET ",
    "state = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'dead' END, ",
    "run_after = CASE WHEN attempts < max_attempts ",
    "THEN now() + least(30 * attempts, 300) * interval '1 second' ELSE run_after END, ",
    "finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END, ",
    "last_error = 'lease expired', lease_owner = NULL, lease_until = NULL, updated_at = now() ",
    "WHERE state = 'leased' AND lease_until < now() - $1 * interval '1 millisecond'"
);

pub const SQL_OUTBOX_ADD: &str = sql!(
    "INSERT INTO operation_outbox (kind, payload, operation_id, max_attempts) ",
    "VALUES ($1, $2, $3, COALESCE($4, 5)) RETURNING id"
);

pub const SQL_OUTBOX_CLAIM: &str = sql!(
    "UPDATE operation_outbox o SET state = 'leased', lease_owner = $1 || '/' || gen_random_uuid()::text, ",
    "lease_until = now() + $2 * interval '1 millisecond', attempts = o.attempts + 1, updated_at = now() ",
    "WHERE o.id IN (SELECT id FROM operation_outbox ",
    "WHERE state = 'pending' AND run_after <= now() AND kind = ANY($3) ",
    "ORDER BY run_after, created_at, id LIMIT $4 FOR UPDATE SKIP LOCKED) ",
    "RETURNING o.id, o.operation_id, o.kind, o.payload, o.state, o.attempts, o.max_attempts, ",
    "o.run_after, o.lease_owner, o.lease_until, o.last_error, o.created_at, o.updated_at, o.sent_at"
);

pub const SQL_OUTBOX_SENT: &str = sql!(
    "UPDATE operation_outbox SET state = 'sent', sent_at = now(), lease_owner = NULL, ",
    "lease_until = NULL, updated_at = now() ",
    "WHERE id = $1 AND lease_owner = $2 AND state = 'leased'"
);

pub const SQL_OUTBOX_FAIL: &str = sql!(
    "UPDATE operation_outbox SET ",
    "state = CASE WHEN $4::bigint IS NOT NULL AND attempts < max_attempts THEN 'pending' ELSE 'dead' END, ",
    "run_after = CASE WHEN $4::bigint IS NOT NULL AND attempts < max_attempts ",
    "THEN now() + $4::bigint * interval '1 millisecond' ELSE run_after END, ",
    "last_error = $3, lease_owner = NULL, lease_until = NULL, updated_at = now() ",
    "WHERE id = $1 AND lease_owner = $2 AND state = 'leased' ",
    "RETURNING state, run_after"
);

pub const SQL_OUTBOX_REAP: &str = sql!(
    "UPDATE operation_outbox SET ",
    "state = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'dead' END, ",
    "run_after = CASE WHEN attempts < max_attempts ",
    "THEN now() + least(30 * attempts, 300) * interval '1 second' ELSE run_after END, ",
    "last_error = 'lease expired', lease_owner = NULL, lease_until = NULL, updated_at = now() ",
    "WHERE state = 'leased' AND lease_until < now() - $1 * interval '1 millisecond'"
);

/// Head of the queue when it can never fit this worker's total credits;
/// only the head, because that is the row blocking everything behind it.
pub const SQL_KILL_OVERSIZED: &str = sql!(
    "UPDATE operation o SET state = 'dead', finished_at = now(), ",
    "last_error = 'cost exceeds worker credits', updated_at = now() ",
    "FROM (SELECT id FROM operation ",
    "WHERE state = 'queued' AND run_after <= now() AND kind = ANY($1) ",
    "ORDER BY run_after, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED) head ",
    "WHERE o.id = head.id AND o.cost > $2 AND o.state = 'queued' ",
    "RETURNING o.id, o.kind, o.key, o.cost"
);

/// Hand a leased row back on shutdown without spending the attempt.
pub const SQL_RELEASE: &str = sql!(
    "UPDATE operation SET state = 'queued', attempts = GREATEST(attempts - 1, 0), ",
    "lease_owner = NULL, lease_until = NULL, run_after = now(), last_error = 'worker shutdown', ",
    "updated_at = now() ",
    "WHERE id = $1 AND lease_owner = $2 AND state = 'leased'"
);

pub const SQL_OUTBOX_RELEASE: &str = sql!(
    "UPDATE operation_outbox SET state = 'pending', attempts = GREATEST(attempts - 1, 0), ",
    "lease_owner = NULL, lease_until = NULL, run_after = now(), last_error = 'worker shutdown', ",
    "updated_at = now() ",
    "WHERE id = $1 AND lease_owner = $2 AND state = 'leased'"
);

pub const SQL_OUTBOX_PENDING: &str =
    "SELECT count(*) AS pending FROM operation_outbox WHERE state = 'pending'";

/// Every statement, for shape checks.
pub const ALL_STATEMENTS: &[(&str, &str)] = &[
    ("enqueue_insert", SQL_ENQUEUE_INSERT),
    ("enqueue_existing", SQL_ENQUEUE_EXISTING),
    ("claim", SQL_CLAIM),
    ("renew", SQL_RENEW),
    ("succeed", SQL_SUCCEED),
    ("fail", SQL_FAIL),
    ("cancel", SQL_CANCEL),
    ("event_lock", SQL_EVENT_LOCK),
    ("event", SQL_EVENT),
    ("events", SQL_EVENTS),
    ("get", SQL_GET),
    ("reap", SQL_REAP),
    ("outbox_add", SQL_OUTBOX_ADD),
    ("outbox_claim", SQL_OUTBOX_CLAIM),
    ("outbox_sent", SQL_OUTBOX_SENT),
    ("outbox_fail", SQL_OUTBOX_FAIL),
    ("outbox_reap", SQL_OUTBOX_REAP),
    ("outbox_pending", SQL_OUTBOX_PENDING),
    ("kill_oversized", SQL_KILL_OVERSIZED),
    ("release", SQL_RELEASE),
    ("outbox_release", SQL_OUTBOX_RELEASE),
];

/// Namespace for the store statements. Every function takes a connection
/// that is already inside the caller's transaction.
#[derive(Debug, Clone, Copy, Default)]
pub struct Store;

impl Store {
    /// Insert unless `(kind, key)` already has an in-flight row. A row that
    /// finishes between the insert and the lookup is retried, so the
    /// caller always gets an id.
    pub async fn enqueue(conn: &mut PgConnection, new: &NewOperation) -> Result<Enqueued> {
        const ATTEMPTS: usize = 3;
        for _ in 0..ATTEMPTS {
            // A savepoint keeps a failed statement from aborting the
            // caller's whole transaction.
            let mut sp = conn.begin().await?;
            let inserted = q(SQL_ENQUEUE_INSERT)
                .bind(&new.kind)
                .bind(&new.key)
                .bind(&new.payload)
                .bind(new.max_attempts)
                .bind(new.cost)
                .bind(new.run_after)
                .fetch_optional(&mut *sp)
                .await?;
            if let Some(row) = inserted {
                let id = row.try_get("id")?;
                sp.commit().await?;
                return Ok(Enqueued {
                    id,
                    existing: false,
                });
            }
            let existing = q(SQL_ENQUEUE_EXISTING)
                .bind(&new.kind)
                .bind(&new.key)
                .fetch_optional(&mut *sp)
                .await?;
            sp.commit().await?;
            if let Some(row) = existing {
                return Ok(Enqueued {
                    id: row.try_get("id")?,
                    existing: true,
                });
            }
        }
        Err(sqlx::Error::Protocol(format!(
            "enqueue {}/{}: in-flight row kept changing",
            new.kind, new.key
        )))
    }

    /// Lease up to `limit` queued operations whose costs together fit in
    /// `max_cost`, oldest `run_after` first. `host` prefixes each row's
    /// per-claim `lease_owner` token; pass that token to every fenced call.
    pub async fn claim(
        conn: &mut PgConnection,
        host: &str,
        kinds: &[String],
        max_cost: i32,
        limit: i32,
        lease: Duration,
    ) -> Result<Vec<Operation>> {
        if kinds.is_empty() || max_cost < 1 || limit < 1 {
            return Ok(Vec::new());
        }
        let rows = q(SQL_CLAIM)
            .bind(host)
            .bind(millis(lease))
            .bind(kinds)
            .bind(max_cost)
            .bind(i64::from(limit))
            .fetch_all(conn)
            .await?;
        rows.iter().map(operation_row).collect()
    }

    /// `false` means the lease is gone: not ours, or no longer leased.
    pub async fn renew(
        conn: &mut PgConnection,
        id: Uuid,
        owner: &str,
        lease: Duration,
    ) -> Result<bool> {
        let done = q(SQL_RENEW)
            .bind(id)
            .bind(owner)
            .bind(millis(lease))
            .execute(conn)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    pub async fn succeed(conn: &mut PgConnection, id: Uuid, owner: &str) -> Result<bool> {
        let done = q(SQL_SUCCEED).bind(id).bind(owner).execute(conn).await?;
        Ok(done.rows_affected() == 1)
    }

    /// `retry_in = None` is a permanent failure.
    pub async fn fail(
        conn: &mut PgConnection,
        id: Uuid,
        owner: &str,
        error: &str,
        retry_in: Option<Duration>,
    ) -> Result<Outcome> {
        let row = q(SQL_FAIL)
            .bind(id)
            .bind(owner)
            .bind(error)
            .bind(retry_in.map(millis))
            .fetch_optional(conn)
            .await?;
        outcome_row(row, State::Queued.as_str())
    }

    /// Only a queued operation can be withdrawn; a running one finishes.
    pub async fn cancel(conn: &mut PgConnection, id: Uuid) -> Result<bool> {
        let done = q(SQL_CANCEL).bind(id).execute(conn).await?;
        Ok(done.rows_affected() == 1)
    }

    /// Append a progress event for a running claim. `None` means the lease
    /// is gone and nothing was written. Locks the operation row until the
    /// caller's transaction ends.
    pub async fn progress(
        conn: &mut PgConnection,
        id: Uuid,
        owner: &str,
        stage: &str,
        percent: Option<i16>,
        message: Option<&str>,
        data: Option<&Value>,
    ) -> Result<Option<i32>> {
        let locked = q(SQL_EVENT_LOCK)
            .bind(id)
            .bind(owner)
            .execute(&mut *conn)
            .await?;
        if locked.rows_affected() != 1 {
            return Ok(None);
        }
        Self::event(conn, id, stage, percent, message, data)
            .await
            .map(Some)
    }

    /// Append an event without a fence. The caller must already hold the
    /// operation's row lock in this transaction (a fenced update such as
    /// [`Store::succeed`]), or sequence numbers can collide.
    pub async fn event(
        conn: &mut PgConnection,
        id: Uuid,
        stage: &str,
        percent: Option<i16>,
        message: Option<&str>,
        data: Option<&Value>,
    ) -> Result<i32> {
        q(SQL_EVENT)
            .bind(id)
            .bind(stage)
            .bind(percent)
            .bind(message)
            .bind(data)
            .fetch_one(conn)
            .await?
            .try_get("seq")
    }

    pub async fn events(conn: &mut PgConnection, id: Uuid, after_seq: i32) -> Result<Vec<Event>> {
        let rows = q(SQL_EVENTS)
            .bind(id)
            .bind(after_seq)
            .fetch_all(conn)
            .await?;
        rows.iter().map(event_row).collect()
    }

    pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<Operation>> {
        q(SQL_GET)
            .bind(id)
            .fetch_optional(conn)
            .await?
            .as_ref()
            .map(operation_row)
            .transpose()
    }

    /// Release leases that expired more than `grace` ago. Idempotent, so
    /// every worker may run it.
    pub async fn reap(conn: &mut PgConnection, grace: Duration) -> Result<u64> {
        let done = q(SQL_REAP).bind(millis(grace)).execute(conn).await?;
        Ok(done.rows_affected())
    }

    /// Record an external effect. Call it in the transaction that commits
    /// the result the effect reports, so neither exists without the other.
    pub async fn outbox_add(
        conn: &mut PgConnection,
        kind: &str,
        payload: &Value,
        operation_id: Option<Uuid>,
        max_attempts: Option<i32>,
    ) -> Result<Uuid> {
        q(SQL_OUTBOX_ADD)
            .bind(kind)
            .bind(payload)
            .bind(operation_id)
            .bind(max_attempts)
            .fetch_one(conn)
            .await?
            .try_get("id")
    }

    /// Same token scheme as [`Store::claim`].
    pub async fn outbox_claim(
        conn: &mut PgConnection,
        host: &str,
        kinds: &[String],
        limit: i32,
        lease: Duration,
    ) -> Result<Vec<OutboxItem>> {
        if kinds.is_empty() || limit < 1 {
            return Ok(Vec::new());
        }
        let rows = q(SQL_OUTBOX_CLAIM)
            .bind(host)
            .bind(millis(lease))
            .bind(kinds)
            .bind(i64::from(limit))
            .fetch_all(conn)
            .await?;
        rows.iter().map(outbox_row).collect()
    }

    pub async fn outbox_sent(conn: &mut PgConnection, id: Uuid, owner: &str) -> Result<bool> {
        let done = q(SQL_OUTBOX_SENT)
            .bind(id)
            .bind(owner)
            .execute(conn)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    pub async fn outbox_fail(
        conn: &mut PgConnection,
        id: Uuid,
        owner: &str,
        error: &str,
        retry_in: Option<Duration>,
    ) -> Result<Outcome> {
        let row = q(SQL_OUTBOX_FAIL)
            .bind(id)
            .bind(owner)
            .bind(error)
            .bind(retry_in.map(millis))
            .fetch_optional(conn)
            .await?;
        outcome_row(row, OutboxState::Pending.as_str())
    }

    /// Kill the queue head for `kinds` if its cost exceeds `credits`, the
    /// most this worker can ever run at once. Returns `(id, kind, key, cost)`.
    pub async fn kill_oversized(
        conn: &mut PgConnection,
        kinds: &[String],
        credits: i32,
    ) -> Result<Option<(Uuid, String, String, i32)>> {
        if kinds.is_empty() {
            return Ok(None);
        }
        q(SQL_KILL_OVERSIZED)
            .bind(kinds)
            .bind(credits)
            .fetch_optional(conn)
            .await?
            .map(|r| {
                Ok((
                    r.try_get("id")?,
                    r.try_get("kind")?,
                    r.try_get("key")?,
                    r.try_get("cost")?,
                ))
            })
            .transpose()
    }

    /// Return a leased operation to the queue at shutdown, refunding the
    /// attempt the claim counted.
    pub async fn release(conn: &mut PgConnection, id: Uuid, owner: &str) -> Result<bool> {
        let done = q(SQL_RELEASE).bind(id).bind(owner).execute(conn).await?;
        Ok(done.rows_affected() == 1)
    }

    pub async fn outbox_release(conn: &mut PgConnection, id: Uuid, owner: &str) -> Result<bool> {
        let done = q(SQL_OUTBOX_RELEASE)
            .bind(id)
            .bind(owner)
            .execute(conn)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    pub async fn outbox_reap(conn: &mut PgConnection, grace: Duration) -> Result<u64> {
        let done = q(SQL_OUTBOX_REAP).bind(millis(grace)).execute(conn).await?;
        Ok(done.rows_affected())
    }

    /// Rows waiting for dispatch; reported while dispatch is switched off.
    pub async fn outbox_pending(conn: &mut PgConnection) -> Result<i64> {
        q(SQL_OUTBOX_PENDING)
            .fetch_one(conn)
            .await?
            .try_get("pending")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states_round_trip() {
        for s in [
            State::Queued,
            State::Leased,
            State::Succeeded,
            State::Failed,
            State::Dead,
            State::Cancelled,
        ] {
            assert_eq!(State::parse(s.as_str()), Some(s));
        }
        for s in [
            OutboxState::Pending,
            OutboxState::Leased,
            OutboxState::Sent,
            OutboxState::Dead,
        ] {
            assert_eq!(OutboxState::parse(s.as_str()), Some(s));
        }
        assert_eq!(State::parse("Queued"), None);
        assert_eq!(OutboxState::parse(""), None);
    }

    #[test]
    fn claim_returns_the_get_columns() {
        let prefixed: Vec<String> = operation_columns!()
            .split(", ")
            .map(|c| format!("o.{c}"))
            .collect();
        assert!(SQL_CLAIM.ends_with(&format!("RETURNING {}", prefixed.join(", "))));
    }

    #[test]
    fn statements_are_pgbouncer_safe() {
        for (name, sql) in ALL_STATEMENTS {
            let upper = sql.to_ascii_uppercase();
            for banned in [
                "SET SESSION",
                "LISTEN",
                "PREPARE",
                "TEMP TABLE",
                "TEMPORARY",
                "ADVISORY",
                "SEARCH_PATH",
            ] {
                assert!(!upper.contains(banned), "{name} contains {banned}");
            }
            assert!(!upper.starts_with("SET "), "{name} sets session state");
        }
    }

    #[test]
    fn handler_writes_are_fenced() {
        for sql in [
            SQL_RENEW,
            SQL_SUCCEED,
            SQL_FAIL,
            SQL_EVENT_LOCK,
            SQL_RELEASE,
            SQL_OUTBOX_SENT,
            SQL_OUTBOX_FAIL,
            SQL_OUTBOX_RELEASE,
        ] {
            assert!(
                sql.contains("WHERE id = $1 AND lease_owner = $2 AND state = 'leased'"),
                "{sql}"
            );
        }
        assert!(SQL_CLAIM.contains("FOR UPDATE SKIP LOCKED"));
        assert!(SQL_OUTBOX_CLAIM.contains("FOR UPDATE SKIP LOCKED"));
        assert!(SQL_ENQUEUE_INSERT
            .contains("ON CONFLICT (kind, key) WHERE state IN ('queued', 'leased') DO NOTHING"));
    }
}
