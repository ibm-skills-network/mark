#![allow(clippy::expect_used, clippy::unwrap_used, clippy::too_many_lines)]

//! The operation store and the worker loop against a real Postgres.
//!
//! Runs only when `DATABASE_URL` is set. Each test creates the three tables
//! in `public` from the migration file and drops them afterwards, so point
//! it at an empty scratch database only. As a guard it skips a database
//! that has Prisma's migration table, or an `operation` table this harness
//! did not create. Tests share the tables, so they run one at a time.

use std::collections::HashSet;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{TimeDelta, Utc};
use mark_ops::store::{NewOperation, Operation, OutboxState, Outcome, State, Store};
use mark_ops::worker::{self, Ctx, Handler, HandlerError, Registry, WorkerConfig};
use mark_platform::{db, Config, Role};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// The migration plus the marker the guard looks for, applied in one
/// transaction so a crash cannot leave unmarked tables behind.
const MIGRATION: &str = concat!(
    include_str!(
        "../../../../apps/api/prisma/migrations/20261026000000_operation_store/migration.sql"
    ),
    "\nCOMMENT ON TABLE operation IS 'mark-ops test fixture';\n"
);
const DROP: &str = "DROP TABLE IF EXISTS operation_outbox, operation_event, operation CASCADE";

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn database_url() -> Option<String> {
    std::env::var("DATABASE_URL").ok().filter(|v| !v.is_empty())
}

async fn scalar_bool(pool: &PgPool, sql: &'static str) -> bool {
    let mut tx = pool.begin().await.unwrap();
    let v: bool = sqlx::query(sql)
        .persistent(false)
        .fetch_one(&mut *tx)
        .await
        .expect(sql)
        .try_get(0)
        .unwrap();
    tx.commit().await.unwrap();
    v
}

async fn exec(pool: &PgPool, sql: &'static str) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::raw_sql(sql).execute(&mut *tx).await.expect(sql);
    tx.commit().await.unwrap();
}

/// Set up the tables, run `body`, always drop the tables, then re-raise a
/// failure from `body`.
async fn with_tables<F, Fut>(body: F)
where
    F: FnOnce(PgPool) -> Fut,
    Fut: Future<Output = ()> + Send + 'static,
{
    let Some(url) = database_url() else {
        eprintln!("DATABASE_URL not set; skipping");
        return;
    };
    let _serial = LOCK.lock().await;
    let leaked: &'static str = Box::leak(url.into_boxed_str());
    let config = Config::load(
        Role::Worker,
        &std::collections::HashMap::from([
            ("DATABASE_URL", leaked),
            ("DATABASE_MAX_CONNECTIONS", "12"),
        ]),
    )
    .unwrap();
    let pool = db::pool(&config).unwrap();

    if scalar_bool(
        &pool,
        "SELECT to_regclass('public._prisma_migrations') IS NOT NULL",
    )
    .await
    {
        eprintln!("DATABASE_URL has a Prisma schema; refusing to create or drop tables there");
        return;
    }
    if scalar_bool(
        &pool,
        "SELECT to_regclass('public.operation') IS NOT NULL \
         AND obj_description(to_regclass('public.operation'), 'pg_class') IS DISTINCT FROM 'mark-ops test fixture'",
    )
    .await
    {
        eprintln!("an operation table not created by this harness exists; skipping");
        return;
    }

    exec(&pool, DROP).await;
    exec(&pool, MIGRATION).await;
    exec(
        &pool,
        "COMMENT ON TABLE operation IS 'mark-ops test fixture'",
    )
    .await;

    let result = tokio::spawn(body(pool.clone())).await;
    exec(&pool, DROP).await;
    pool.close().await;
    if let Err(e) = result {
        std::panic::resume_unwind(e.into_panic());
    }
}

fn new_op(kind: &str, key: &str) -> NewOperation {
    NewOperation {
        kind: kind.to_owned(),
        key: key.to_owned(),
        payload: json!({ "key": key }),
        max_attempts: None,
        cost: None,
        run_after: None,
    }
}

async fn enqueue(pool: &PgPool, new: &NewOperation) -> mark_ops::Enqueued {
    let mut tx = pool.begin().await.unwrap();
    let e = Store::enqueue(&mut tx, new).await.unwrap();
    tx.commit().await.unwrap();
    e
}

async fn claim(
    pool: &PgPool,
    owner: &str,
    kinds: &[&str],
    max_cost: i32,
    limit: i32,
    lease: Duration,
) -> Vec<Operation> {
    let kinds: Vec<String> = kinds.iter().map(|k| (*k).to_owned()).collect();
    let mut tx = pool.begin().await.unwrap();
    let ops = Store::claim(&mut tx, owner, &kinds, max_cost, limit, lease)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    ops
}

async fn get(pool: &PgPool, id: Uuid) -> Operation {
    let mut tx = pool.begin().await.unwrap();
    let op = Store::get(&mut tx, id).await.unwrap().expect("row");
    tx.commit().await.unwrap();
    op
}

async fn stages(pool: &PgPool, id: Uuid) -> Vec<String> {
    let mut tx = pool.begin().await.unwrap();
    let events = Store::events(&mut tx, id, 0).await.unwrap();
    tx.commit().await.unwrap();
    events.into_iter().map(|e| e.stage).collect()
}

const LEASE: Duration = Duration::from_secs(60);

/// The per-claim lease token the fenced calls need.
fn token(op: &Operation) -> String {
    op.lease_owner.clone().expect("leased row has an owner")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn enqueue_dedupes_in_flight_rows_and_cancel_finishes() {
    with_tables(|pool| async move {
        let first = enqueue(&pool, &new_op("t1.kind", "k")).await;
        assert!(!first.existing);
        let second = enqueue(&pool, &new_op("t1.kind", "k")).await;
        assert!(second.existing);
        assert_eq!(second.id, first.id);

        // Still in flight while leased.
        let claimed = claim(&pool, "a/1", &["t1.kind"], 10, 10, LEASE).await;
        assert_eq!(claimed.len(), 1);
        assert_eq!(enqueue(&pool, &new_op("t1.kind", "k")).await.id, first.id);

        let mut tx = pool.begin().await.unwrap();
        assert!(Store::succeed(&mut tx, first.id, &token(&claimed[0]))
            .await
            .unwrap());
        tx.commit().await.unwrap();
        let done = get(&pool, first.id).await;
        assert_eq!(done.state, State::Succeeded);
        assert!(done.finished_at.is_some());
        assert!(done.lease_owner.is_none() && done.lease_until.is_none());

        let third = enqueue(&pool, &new_op("t1.kind", "k")).await;
        assert!(!third.existing);
        assert_ne!(third.id, first.id);

        // Cancel: only from queued, and it stamps finished_at for retention.
        let mut tx = pool.begin().await.unwrap();
        assert!(Store::cancel(&mut tx, third.id).await.unwrap());
        assert!(!Store::cancel(&mut tx, third.id).await.unwrap());
        tx.commit().await.unwrap();
        let cancelled = get(&pool, third.id).await;
        assert_eq!(cancelled.state, State::Cancelled);
        assert!(cancelled.finished_at.is_some());

        let leased = enqueue(&pool, &new_op("t1.kind", "leased")).await;
        claim(&pool, "a/1", &["t1.kind"], 10, 10, LEASE).await;
        let mut tx = pool.begin().await.unwrap();
        assert!(!Store::cancel(&mut tx, leased.id).await.unwrap());
        tx.commit().await.unwrap();
        assert_eq!(get(&pool, leased.id).await.state, State::Leased);

        // Column defaults apply when the producer leaves fields unset.
        let op = get(&pool, leased.id).await;
        assert_eq!((op.max_attempts, op.cost, op.attempts), (3, 1, 1));
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_claims_never_share_a_row() {
    with_tables(|pool| async move {
        for i in 0..50 {
            enqueue(&pool, &new_op("t2.kind", &format!("k{i}"))).await;
        }
        let spawn_owner = |owner: &'static str| {
            let pool = pool.clone();
            tokio::spawn(async move {
                let mut ids = Vec::new();
                for _ in 0..20 {
                    for op in claim(&pool, owner, &["t2.kind"], 100, 2, LEASE).await {
                        assert!(token(&op).starts_with(&format!("{owner}/")));
                        ids.push(op.id);
                    }
                }
                ids
            })
        };
        let a = spawn_owner("a/1");
        let b = spawn_owner("b/1");
        let a: Vec<Uuid> = a.await.unwrap();
        let b: Vec<Uuid> = b.await.unwrap();
        let sa: HashSet<Uuid> = a.iter().copied().collect();
        let sb: HashSet<Uuid> = b.iter().copied().collect();
        assert_eq!(sa.len(), a.len(), "owner a got a row twice");
        assert_eq!(sb.len(), b.len(), "owner b got a row twice");
        assert_eq!(sa.intersection(&sb).count(), 0);
        assert_eq!(sa.union(&sb).count(), 50);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn claim_respects_kind_cost_run_after_and_order() {
    with_tables(|pool| async move {
        let now = Utc::now();
        let at = |mins: i64| Some(now - TimeDelta::minutes(mins));

        let mut b = new_op("t3.b", "b");
        b.run_after = at(10);
        enqueue(&pool, &b).await;
        let mut heavy = new_op("t3.a", "heavy");
        heavy.cost = Some(5);
        heavy.run_after = at(10);
        let heavy = enqueue(&pool, &heavy).await;
        let mut future = new_op("t3.a", "future");
        future.run_after = Some(now + TimeDelta::minutes(10));
        let future = enqueue(&pool, &future).await;
        let mut ids = Vec::new();
        for (key, mins) in [("m3", 3), ("m1", 1), ("m2", 2)] {
            let mut op = new_op("t3.a", key);
            op.run_after = at(mins);
            ids.push((key, enqueue(&pool, &op).await.id));
        }

        // The heavy head does not fit a budget of 4: it blocks the queue
        // rather than being skipped, so it cannot starve.
        assert!(claim(&pool, "a/1", &["t3.a"], 4, 10, LEASE)
            .await
            .is_empty());
        let got = claim(&pool, "a/1", &["t3.a"], 5, 10, LEASE).await;
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, heavy.id);

        let mut order = Vec::new();
        for _ in 0..4 {
            for op in claim(&pool, "a/1", &["t3.a"], 4, 1, LEASE).await {
                assert_eq!(op.kind, "t3.a");
                order.push(op.key);
            }
        }
        assert_eq!(order, vec!["m3", "m2", "m1"]);
        assert_eq!(get(&pool, future.id).await.state, State::Queued);

        // The other kind stays untouched until asked for.
        let b_rows = claim(&pool, "a/1", &["t3.b"], 5, 10, LEASE).await;
        assert_eq!(b_rows.len(), 1);

        // Several rows: only the prefix whose total cost fits is taken.
        for i in 0..3 {
            let mut op = new_op("t3.c", &format!("c{i}"));
            op.cost = Some(3);
            op.run_after = at(5 - i);
            enqueue(&pool, &op).await;
        }
        let got = claim(&pool, "a/1", &["t3.c"], 7, 10, LEASE).await;
        assert_eq!(got.len(), 2);
        assert_eq!(got.iter().map(|o| o.cost).sum::<i32>(), 6);

        // Empty kinds or budget claims nothing without touching the table.
        assert!(claim(&pool, "a/1", &[], 10, 10, LEASE).await.is_empty());
        assert!(claim(&pool, "a/1", &["t3.c"], 0, 10, LEASE)
            .await
            .is_empty());
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn writes_by_the_wrong_owner_are_rejected() {
    with_tables(|pool| async move {
        let e = enqueue(&pool, &new_op("t4.kind", "k")).await;
        let a = token(&claim(&pool, "a/1", &["t4.kind"], 10, 10, LEASE).await[0]);
        let before = get(&pool, e.id).await;

        let mut tx = pool.begin().await.unwrap();
        assert!(
            !Store::renew(&mut tx, e.id, "b/1", Duration::from_secs(600))
                .await
                .unwrap()
        );
        assert!(!Store::succeed(&mut tx, e.id, "b/1").await.unwrap());
        assert_eq!(
            Store::fail(&mut tx, e.id, "b/1", "nope", None)
                .await
                .unwrap(),
            Outcome::LeaseLost
        );
        tx.commit().await.unwrap();
        assert_eq!(get(&pool, e.id).await, before);

        let mut tx = pool.begin().await.unwrap();
        assert!(Store::renew(&mut tx, e.id, &a, Duration::from_secs(600))
            .await
            .unwrap());
        tx.commit().await.unwrap();
        let renewed = get(&pool, e.id).await;
        assert!(renewed.lease_until > before.lease_until);

        // A finished row cannot be renewed even by its last owner.
        let mut tx = pool.begin().await.unwrap();
        assert!(Store::succeed(&mut tx, e.id, &a).await.unwrap());
        assert!(!Store::renew(&mut tx, e.id, &a, LEASE).await.unwrap());
        tx.commit().await.unwrap();
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fail_requeues_or_kills() {
    with_tables(|pool| async move {
        let retry = enqueue(&pool, &new_op("t5.kind", "retry")).await;
        let t = token(&claim(&pool, "a/1", &["t5.kind"], 10, 10, LEASE).await[0]);
        let mut tx = pool.begin().await.unwrap();
        let outcome = Store::fail(
            &mut tx,
            retry.id,
            &t,
            "provider 503",
            Some(Duration::from_secs(60)),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let Outcome::Requeued { run_after } = outcome else {
            panic!("expected requeue, got {outcome:?}");
        };
        let op = get(&pool, retry.id).await;
        assert_eq!(op.state, State::Queued);
        assert_eq!(op.run_after, run_after);
        assert!(run_after > Utc::now() + TimeDelta::seconds(30));
        assert_eq!(op.last_error.as_deref(), Some("provider 503"));
        assert!(op.lease_owner.is_none() && op.finished_at.is_none());
        assert_eq!(op.attempts, 1);
        // Not claimable before run_after.
        assert!(claim(&pool, "a/1", &["t5.kind"], 10, 10, LEASE)
            .await
            .is_empty());

        let mut last = new_op("t5.kind", "last");
        last.max_attempts = Some(1);
        let last = enqueue(&pool, &last).await;
        let t = token(&claim(&pool, "a/1", &["t5.kind"], 10, 10, LEASE).await[0]);
        let mut tx = pool.begin().await.unwrap();
        let outcome = Store::fail(&mut tx, last.id, &t, "again", Some(Duration::ZERO))
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(outcome, Outcome::Dead);
        let op = get(&pool, last.id).await;
        assert_eq!(op.state, State::Dead);
        assert!(op.finished_at.is_some());
        assert!(op.lease_owner.is_none());

        let permanent = enqueue(&pool, &new_op("t5.kind", "permanent")).await;
        let t = token(&claim(&pool, "a/1", &["t5.kind"], 10, 10, LEASE).await[0]);
        let mut tx = pool.begin().await.unwrap();
        let outcome = Store::fail(&mut tx, permanent.id, &t, "bad payload", None)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(outcome, Outcome::Dead);
        let op = get(&pool, permanent.id).await;
        assert_eq!((op.state, op.attempts), (State::Dead, 1));
        assert!(op.finished_at.is_some());
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reap_releases_only_expired_leases() {
    with_tables(|pool| async move {
        let short = Duration::from_millis(10);
        let again = enqueue(&pool, &new_op("t6.kind", "again")).await;
        let mut last = new_op("t6.kind", "last");
        last.max_attempts = Some(1);
        let last = enqueue(&pool, &last).await;
        assert_eq!(
            claim(&pool, "a/1", &["t6.kind"], 10, 10, short).await.len(),
            2
        );
        let live = enqueue(&pool, &new_op("t6.kind", "live")).await;
        let live_token = token(&claim(&pool, "b/1", &["t6.kind"], 10, 10, LEASE).await[0]);
        tokio::time::sleep(Duration::from_millis(100)).await;

        let mut tx = pool.begin().await.unwrap();
        // A long grace leaves the just-expired leases alone.
        assert_eq!(Store::reap(&mut tx, LEASE).await.unwrap(), 0);
        assert_eq!(Store::reap(&mut tx, Duration::ZERO).await.unwrap(), 2);
        assert_eq!(Store::reap(&mut tx, Duration::ZERO).await.unwrap(), 0);
        tx.commit().await.unwrap();

        let op = get(&pool, again.id).await;
        assert_eq!((op.state, op.attempts), (State::Queued, 1));
        assert_eq!(op.last_error.as_deref(), Some("lease expired"));
        // Backoff: 30 s per attempt so far.
        assert!(op.run_after > Utc::now() + TimeDelta::seconds(20));
        assert!(op.run_after < Utc::now() + TimeDelta::seconds(40));
        assert!(op.lease_owner.is_none() && op.finished_at.is_none());
        let op = get(&pool, last.id).await;
        assert_eq!(op.state, State::Dead);
        assert!(op.finished_at.is_some());
        let op = get(&pool, live.id).await;
        assert_eq!(op.state, State::Leased);
        assert_eq!(op.lease_owner, Some(live_token));
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn events_number_per_operation_and_page() {
    with_tables(|pool| async move {
        let one = enqueue(&pool, &new_op("t7.kind", "one")).await.id;
        let two = enqueue(&pool, &new_op("t7.kind", "two")).await.id;
        let data = json!({ "questions": 4 });
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(
            Store::event(&mut tx, one, "claimed", None, None, None)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            Store::event(&mut tx, two, "claimed", None, None, None)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            Store::event(&mut tx, one, "grading", Some(50), Some("half"), Some(&data))
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            Store::event(&mut tx, one, "done", Some(100), None, None)
                .await
                .unwrap(),
            3
        );
        assert_eq!(
            Store::event(&mut tx, two, "done", None, None, None)
                .await
                .unwrap(),
            2
        );
        // The check constraint bounds percent.
        let mut sp = sqlx::Acquire::begin(&mut *tx).await.unwrap();
        assert!(Store::event(&mut sp, one, "bad", Some(101), None, None)
            .await
            .is_err());
        sp.rollback().await.unwrap();
        tx.commit().await.unwrap();

        let mut tx = pool.begin().await.unwrap();
        let all = Store::events(&mut tx, one, 0).await.unwrap();
        let page = Store::events(&mut tx, one, 1).await.unwrap();
        let none = Store::events(&mut tx, one, 3).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(all.iter().map(|e| e.seq).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert_eq!(page.iter().map(|e| e.seq).collect::<Vec<_>>(), vec![2, 3]);
        assert!(none.is_empty());
        assert_eq!(page[0].stage, "grading");
        assert_eq!(page[0].percent, Some(50));
        assert_eq!(page[0].message.as_deref(), Some("half"));
        assert_eq!(page[0].data, Some(data));
        assert_eq!(page[0].operation_id, one);
    })
    .await;
}

async fn outbox_row(pool: &PgPool, id: Uuid) -> (String, i32, Option<String>, bool, Option<Uuid>) {
    let mut tx = pool.begin().await.unwrap();
    let r = sqlx::query(
        "SELECT state, attempts, last_error, sent_at IS NOT NULL AS sent, operation_id \
         FROM operation_outbox WHERE id = $1",
    )
    .persistent(false)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
    (
        r.get("state"),
        r.get("attempts"),
        r.get("last_error"),
        r.get("sent"),
        r.get("operation_id"),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn outbox_commits_with_the_result_and_retries() {
    with_tables(|pool| async move {
        let kinds = vec!["t8.push".to_owned()];
        let op = enqueue(&pool, &new_op("t8.kind", "k")).await.id;
        let t = token(&claim(&pool, "a/1", &["t8.kind"], 10, 10, LEASE).await[0]);

        // Rolled back with the result: no effect row survives.
        let mut tx = pool.begin().await.unwrap();
        assert!(Store::succeed(&mut tx, op, &t).await.unwrap());
        let ghost = Store::outbox_add(&mut tx, "t8.push", &json!({}), Some(op), None)
            .await
            .unwrap();
        tx.rollback().await.unwrap();
        assert_eq!(get(&pool, op).await.state, State::Leased);

        let mut tx = pool.begin().await.unwrap();
        assert!(Store::succeed(&mut tx, op, &t).await.unwrap());
        let item = Store::outbox_add(
            &mut tx,
            "t8.push",
            &json!({ "score": 1 }),
            Some(op),
            Some(2),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(get(&pool, op).await.state, State::Succeeded);
        let mut tx = pool.begin().await.unwrap();
        let ghost_rows = sqlx::query("SELECT 1 FROM operation_outbox WHERE id = $1")
            .persistent(false)
            .bind(ghost)
            .fetch_optional(&mut *tx)
            .await
            .unwrap();
        assert!(ghost_rows.is_none());
        assert_eq!(Store::outbox_pending(&mut tx).await.unwrap(), 1);

        let claimed = Store::outbox_claim(&mut tx, "a/1", &kinds, 10, LEASE)
            .await
            .unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].id, item);
        assert_eq!(claimed[0].state, OutboxState::Leased);
        assert_eq!(claimed[0].operation_id, Some(op));
        assert_eq!(claimed[0].payload, json!({ "score": 1 }));
        let t = claimed[0].lease_owner.clone().unwrap();
        assert!(t.starts_with("a/1/"));
        assert!(Store::outbox_claim(&mut tx, "b/1", &kinds, 10, LEASE)
            .await
            .unwrap()
            .is_empty());
        assert!(!Store::outbox_sent(&mut tx, item, "b/1").await.unwrap());
        assert_eq!(
            Store::outbox_fail(&mut tx, item, "b/1", "x", None)
                .await
                .unwrap(),
            Outcome::LeaseLost
        );
        let outcome = Store::outbox_fail(&mut tx, item, &t, "gateway 502", Some(Duration::ZERO))
            .await
            .unwrap();
        assert!(matches!(outcome, Outcome::Requeued { .. }), "{outcome:?}");
        tx.commit().await.unwrap();
        assert_eq!(outbox_row(&pool, item).await.0, "pending");

        let mut tx = pool.begin().await.unwrap();
        let again = Store::outbox_claim(&mut tx, "a/1", &kinds, 10, LEASE)
            .await
            .unwrap();
        assert_eq!(again.len(), 1);
        assert_eq!(again[0].attempts, 2);
        let t2 = again[0].lease_owner.clone().unwrap();
        assert_ne!(t2, t);
        assert_eq!(
            Store::outbox_fail(&mut tx, item, &t2, "gateway 502", Some(Duration::ZERO))
                .await
                .unwrap(),
            Outcome::Dead
        );
        tx.commit().await.unwrap();
        let (state, attempts, error, sent, _) = outbox_row(&pool, item).await;
        assert_eq!((state.as_str(), attempts, sent), ("dead", 2, false));
        assert_eq!(error.as_deref(), Some("gateway 502"));

        // Sent.
        let mut tx = pool.begin().await.unwrap();
        let sent_id = Store::outbox_add(&mut tx, "t8.push", &json!({}), None, None)
            .await
            .unwrap();
        let t = Store::outbox_claim(&mut tx, "a/1", &kinds, 10, LEASE)
            .await
            .unwrap()[0]
            .lease_owner
            .clone()
            .unwrap();
        assert!(Store::outbox_sent(&mut tx, sent_id, &t).await.unwrap());
        assert!(!Store::outbox_sent(&mut tx, sent_id, &t).await.unwrap());
        tx.commit().await.unwrap();
        let (state, _, _, sent, operation_id) = outbox_row(&pool, sent_id).await;
        assert_eq!((state.as_str(), sent, operation_id), ("sent", true, None));

        // Reaped.
        let mut tx = pool.begin().await.unwrap();
        let reap_id = Store::outbox_add(&mut tx, "t8.push", &json!({}), None, None)
            .await
            .unwrap();
        Store::outbox_claim(&mut tx, "a/1", &kinds, 10, Duration::from_millis(10))
            .await
            .unwrap();
        tx.commit().await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(
            Store::outbox_reap(&mut tx, Duration::ZERO).await.unwrap(),
            1
        );
        tx.commit().await.unwrap();
        let (state, _, error, _, _) = outbox_row(&pool, reap_id).await;
        assert_eq!(state, "pending");
        assert_eq!(error.as_deref(), Some("lease expired"));
        let mut tx = pool.begin().await.unwrap();
        let backoff: bool = sqlx::query(
            "SELECT run_after > now() + interval '20 seconds' FROM operation_outbox WHERE id = $1",
        )
        .persistent(false)
        .bind(reap_id)
        .fetch_one(&mut *tx)
        .await
        .unwrap()
        .get(0);
        tx.commit().await.unwrap();
        assert!(backoff, "reaped outbox row has no backoff");
    })
    .await;
}

// ------------------------------------------------------------- runtime

fn worker_config(host: &str) -> WorkerConfig {
    WorkerConfig {
        host: host.to_owned(),
        credits: 8,
        kinds: None,
        lease: Duration::from_secs(5),
        busy_poll: Duration::from_millis(50),
        idle_poll: Duration::from_millis(100),
        reap_every: Duration::from_millis(200),
        consume_work: true,
        dispatch_external_effects: false,
        drain: Duration::from_secs(5),
    }
}

/// Resolves once `done` holds or `limit` passes; the test asserts after.
async fn until<F, Fut>(limit: Duration, mut done: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let deadline = tokio::time::Instant::now() + limit;
    while tokio::time::Instant::now() < deadline {
        if done().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn count_state(pool: &PgPool, state: &str) -> i64 {
    let mut tx = pool.begin().await.unwrap();
    let n: i64 = sqlx::query("SELECT count(*) FROM operation WHERE state = $1")
        .persistent(false)
        .bind(state)
        .fetch_one(&mut *tx)
        .await
        .unwrap()
        .get(0);
    tx.commit().await.unwrap();
    n
}

#[derive(Default)]
struct Recorder {
    running: AtomicI32,
    peak: AtomicI32,
    calls: Mutex<Vec<Uuid>>,
}

struct Work(Arc<Recorder>);

#[async_trait]
impl Handler for Work {
    fn kind(&self) -> &'static str {
        "rt.work"
    }
    async fn run(&self, ctx: &Ctx, op: &Operation) -> Result<(), HandlerError> {
        let now = self.0.running.fetch_add(op.cost, Ordering::SeqCst) + op.cost;
        self.0.peak.fetch_max(now, Ordering::SeqCst);
        self.0.calls.lock().unwrap().push(op.id);
        ctx.progress("working", Some(50), None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        self.0.running.fetch_sub(op.cost, Ordering::SeqCst);
        if op.payload.get("fail") == Some(&Value::Bool(true)) {
            return Err(HandlerError::Permanent("asked to fail".to_owned()));
        }
        Ok(())
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn runtime_processes_rows_within_credits() {
    with_tables(|pool| async move {
        let recorder = Arc::new(Recorder::default());
        let mut registry = Registry::new();
        registry.register(Arc::new(Work(recorder.clone()))).unwrap();

        let mut ids = Vec::new();
        for (key, cost) in [("five", 5), ("four", 4), ("one-a", 1), ("one-b", 1)] {
            let mut op = new_op("rt.work", key);
            op.cost = Some(cost);
            ids.push(enqueue(&pool, &op).await.id);
        }
        let mut failing = new_op("rt.work", "fail");
        failing.payload = json!({ "fail": true });
        let failing = enqueue(&pool, &failing).await.id;
        // A kind with no handler is never claimed.
        let orphan = enqueue(&pool, &new_op("rt.orphan", "k")).await.id;

        let watch = pool.clone();
        let shutdown = async move {
            until(Duration::from_secs(20), || {
                let pool = watch.clone();
                async move {
                    count_state(&pool, "succeeded").await == 4
                        && count_state(&pool, "dead").await == 1
                }
            })
            .await;
        };
        worker::run(pool.clone(), registry, worker_config("rt/1"), shutdown)
            .await
            .unwrap();

        for id in &ids {
            let op = get(&pool, *id).await;
            assert_eq!(op.state, State::Succeeded, "{}", op.key);
            assert_eq!(stages(&pool, *id).await, vec!["claimed", "working", "done"]);
        }
        let dead = get(&pool, failing).await;
        assert_eq!(dead.state, State::Dead);
        assert_eq!(dead.last_error.as_deref(), Some("asked to fail"));
        assert_eq!(
            stages(&pool, failing).await,
            vec!["claimed", "working", "error"]
        );
        assert_eq!(get(&pool, orphan).await.state, State::Queued);
        assert!(
            recorder.peak.load(Ordering::SeqCst) <= 8,
            "credits exceeded"
        );
        assert_eq!(recorder.calls.lock().unwrap().len(), 5);
    })
    .await;
}

#[derive(Default)]
struct SleepFlags {
    started: AtomicBool,
    completed: AtomicBool,
    dropped: AtomicBool,
}

struct Sleeper(Arc<SleepFlags>);

struct SetOnDrop(Arc<SleepFlags>);

impl Drop for SetOnDrop {
    fn drop(&mut self) {
        self.0.dropped.store(true, Ordering::SeqCst);
    }
}

#[async_trait]
impl Handler for Sleeper {
    fn kind(&self) -> &'static str {
        "rt.sleep"
    }
    async fn run(&self, _: &Ctx, _: &Operation) -> Result<(), HandlerError> {
        let _guard = SetOnDrop(self.0.clone());
        self.0.started.store(true, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(30)).await;
        self.0.completed.store(true, Ordering::SeqCst);
        Ok(())
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn runtime_aborts_a_handler_whose_lease_is_lost() {
    with_tables(|pool| async move {
        let flags = Arc::new(SleepFlags::default());
        let mut registry = Registry::new();
        registry.register(Arc::new(Sleeper(flags.clone()))).unwrap();
        let mut op = new_op("rt.sleep", "k");
        op.max_attempts = Some(1);
        let id = enqueue(&pool, &op).await.id;

        let mut config = worker_config("rt/2");
        config.lease = Duration::from_secs(1);
        let watch = pool.clone();
        let seen = flags.clone();
        let shutdown = async move {
            until(Duration::from_secs(10), || {
                let seen = seen.clone();
                async move { seen.started.load(Ordering::SeqCst) }
            })
            .await;
            // Simulate this worker stalling past its lease: the row now looks
            // expired and held by someone else.
            exec(
                &watch,
                "UPDATE operation SET lease_owner = 'stalled/test', lease_until = now() - interval '1 hour' WHERE state = 'leased'",
            )
            .await;
            until(Duration::from_secs(10), || {
                let pool = watch.clone();
                let seen = seen.clone();
                async move {
                    seen.dropped.load(Ordering::SeqCst) && count_state(&pool, "dead").await == 1
                }
            })
            .await;
        };
        worker::run(pool.clone(), registry, config, shutdown)
            .await
            .unwrap();

        assert!(flags.started.load(Ordering::SeqCst));
        assert!(flags.dropped.load(Ordering::SeqCst), "handler not aborted");
        assert!(!flags.completed.load(Ordering::SeqCst));
        let op = get(&pool, id).await;
        assert_eq!(op.state, State::Dead);
        assert_eq!(op.last_error.as_deref(), Some("lease expired"));
        assert_eq!(stages(&pool, id).await, vec!["claimed"]);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn runtime_claims_nothing_when_consume_work_is_off() {
    with_tables(|pool| async move {
        let recorder = Arc::new(Recorder::default());
        let mut registry = Registry::new();
        registry.register(Arc::new(Work(recorder.clone()))).unwrap();
        let id = enqueue(&pool, &new_op("rt.work", "k")).await.id;

        let mut config = worker_config("rt/3");
        config.consume_work = false;
        worker::run(
            pool.clone(),
            registry,
            config,
            tokio::time::sleep(Duration::from_millis(500)),
        )
        .await
        .unwrap();

        let op = get(&pool, id).await;
        assert_eq!((op.state, op.attempts), (State::Queued, 0));
        assert!(recorder.calls.lock().unwrap().is_empty());
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn runtime_with_no_handlers_still_reaps() {
    with_tables(|pool| async move {
        let expired = enqueue(&pool, &new_op("rt.any", "expired")).await.id;
        claim(
            &pool,
            "gone/1",
            &["rt.any"],
            10,
            10,
            Duration::from_millis(10),
        )
        .await;
        let queued = enqueue(&pool, &new_op("rt.any", "queued")).await.id;

        let mut config = worker_config("rt/4");
        // Grace equals the lease, so keep it short for the reaper to act.
        config.lease = Duration::from_millis(10);
        let watch = pool.clone();
        let shutdown = async move {
            until(Duration::from_secs(10), || {
                let pool = watch.clone();
                async move { count_state(&pool, "leased").await == 0 }
            })
            .await;
            // A few more polls, to show nothing gets claimed.
            tokio::time::sleep(Duration::from_millis(300)).await;
        };
        worker::run(pool.clone(), Registry::new(), config, shutdown)
            .await
            .unwrap();

        let op = get(&pool, expired).await;
        assert_eq!((op.state, op.attempts), (State::Queued, 1));
        assert_eq!(op.last_error.as_deref(), Some("lease expired"));
        let op = get(&pool, queued).await;
        assert_eq!((op.state, op.attempts), (State::Queued, 0));
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stale_claim_token_is_fenced_out_after_reclaim() {
    with_tables(|pool| async move {
        let id = enqueue(&pool, &new_op("t9.kind", "k")).await.id;
        let first = token(
            &claim(
                &pool,
                "host-a",
                &["t9.kind"],
                10,
                10,
                Duration::from_millis(10),
            )
            .await[0],
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(Store::reap(&mut tx, Duration::ZERO).await.unwrap(), 1);
        tx.commit().await.unwrap();
        // Skip the reap backoff so the same host can claim it again now.
        exec(
            &pool,
            "UPDATE operation SET run_after = now() WHERE kind = 't9.kind'",
        )
        .await;
        let second = token(&claim(&pool, "host-a", &["t9.kind"], 10, 10, LEASE).await[0]);
        assert_ne!(first, second);
        assert!(first.starts_with("host-a/") && second.starts_with("host-a/"));

        let mut tx = pool.begin().await.unwrap();
        assert!(!Store::renew(&mut tx, id, &first, LEASE).await.unwrap());
        assert_eq!(
            Store::progress(&mut tx, id, &first, "grading", None, None, None)
                .await
                .unwrap(),
            None
        );
        assert!(!Store::succeed(&mut tx, id, &first).await.unwrap());
        assert_eq!(
            Store::fail(&mut tx, id, &first, "stale", None)
                .await
                .unwrap(),
            Outcome::LeaseLost
        );
        assert!(!Store::release(&mut tx, id, &first).await.unwrap());
        tx.commit().await.unwrap();
        let op = get(&pool, id).await;
        assert_eq!((op.state, op.attempts), (State::Leased, 2));
        assert_eq!(op.lease_owner.as_deref(), Some(second.as_str()));
        assert!(stages(&pool, id).await.is_empty());

        let mut tx = pool.begin().await.unwrap();
        assert!(Store::renew(&mut tx, id, &second, LEASE).await.unwrap());
        assert_eq!(
            Store::progress(&mut tx, id, &second, "grading", None, None, None)
                .await
                .unwrap(),
            Some(1)
        );
        assert!(Store::succeed(&mut tx, id, &second).await.unwrap());
        tx.commit().await.unwrap();
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn oversized_head_is_killed_and_unblocks_the_queue() {
    with_tables(|pool| async move {
        let kinds = vec!["t10.kind".to_owned()];
        let mut big = new_op("t10.kind", "big");
        big.cost = Some(20);
        big.run_after = Some(Utc::now() - TimeDelta::minutes(2));
        let big = enqueue(&pool, &big).await.id;
        let mut fits = new_op("t10.kind", "fits");
        fits.cost = Some(6);
        fits.run_after = Some(Utc::now() - TimeDelta::minutes(1));
        let fits = enqueue(&pool, &fits).await.id;

        // The head blocks: nothing behind it is claimed.
        assert!(claim(&pool, "a/1", &["t10.kind"], 8, 10, LEASE)
            .await
            .is_empty());

        let mut tx = pool.begin().await.unwrap();
        let killed = Store::kill_oversized(&mut tx, &kinds, 8).await.unwrap();
        // The new head fits the total credits, so it is left alone.
        let again = Store::kill_oversized(&mut tx, &kinds, 8).await.unwrap();
        tx.commit().await.unwrap();
        let (id, kind, key, cost) = killed.expect("head killed");
        assert_eq!(
            (id, kind.as_str(), key.as_str(), cost),
            (big, "t10.kind", "big", 20)
        );
        assert!(again.is_none());
        let op = get(&pool, big).await;
        assert_eq!(op.state, State::Dead);
        assert_eq!(
            op.last_error.as_deref(),
            Some("cost exceeds worker credits")
        );
        assert!(op.finished_at.is_some());

        // Waits for credits rather than being skipped, then runs.
        assert!(claim(&pool, "a/1", &["t10.kind"], 5, 10, LEASE)
            .await
            .is_empty());
        assert_eq!(get(&pool, fits).await.state, State::Queued);
        let got = claim(&pool, "a/1", &["t10.kind"], 8, 10, LEASE).await;
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, fits);

        // A leased row is never killed.
        let mut tx = pool.begin().await.unwrap();
        assert!(Store::kill_oversized(&mut tx, &kinds, 1)
            .await
            .unwrap()
            .is_none());
        tx.commit().await.unwrap();
        assert_eq!(get(&pool, fits).await.state, State::Leased);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn release_hands_the_row_back_and_refunds_the_attempt() {
    with_tables(|pool| async move {
        let id = enqueue(&pool, &new_op("t11.kind", "k")).await.id;
        let t = token(&claim(&pool, "a/1", &["t11.kind"], 10, 10, LEASE).await[0]);
        let mut tx = pool.begin().await.unwrap();
        assert!(!Store::release(&mut tx, id, "a/1/other").await.unwrap());
        assert!(Store::release(&mut tx, id, &t).await.unwrap());
        assert!(!Store::release(&mut tx, id, &t).await.unwrap());
        tx.commit().await.unwrap();
        let op = get(&pool, id).await;
        assert_eq!((op.state, op.attempts), (State::Queued, 0));
        assert_eq!(op.last_error.as_deref(), Some("worker shutdown"));
        assert!(op.lease_owner.is_none() && op.lease_until.is_none());
        assert_eq!(
            claim(&pool, "a/1", &["t11.kind"], 10, 10, LEASE)
                .await
                .len(),
            1
        );

        let kinds = vec!["t11.push".to_owned()];
        let mut tx = pool.begin().await.unwrap();
        let item = Store::outbox_add(&mut tx, "t11.push", &json!({}), None, None)
            .await
            .unwrap();
        let t = Store::outbox_claim(&mut tx, "a/1", &kinds, 10, LEASE)
            .await
            .unwrap()[0]
            .lease_owner
            .clone()
            .unwrap();
        assert!(!Store::outbox_release(&mut tx, item, "a/1/other")
            .await
            .unwrap());
        assert!(Store::outbox_release(&mut tx, item, &t).await.unwrap());
        tx.commit().await.unwrap();
        let (state, attempts, error, _, _) = outbox_row(&pool, item).await;
        assert_eq!((state.as_str(), attempts), ("pending", 0));
        assert_eq!(error.as_deref(), Some("worker shutdown"));
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_progress_numbers_events_consecutively() {
    with_tables(|pool| async move {
        let id = enqueue(&pool, &new_op("t12.kind", "k")).await.id;
        let t = token(&claim(&pool, "a/1", &["t12.kind"], 10, 10, LEASE).await[0]);
        let mut tasks = Vec::new();
        for task in 0..10 {
            let pool = pool.clone();
            let t = t.clone();
            tasks.push(tokio::spawn(async move {
                for i in 0..10 {
                    let mut tx = pool.begin().await.unwrap();
                    let message = format!("{task}-{i}");
                    let seq =
                        Store::progress(&mut tx, id, &t, "working", None, Some(&message), None)
                            .await
                            .unwrap();
                    assert!(seq.is_some());
                    tx.commit().await.unwrap();
                }
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        let mut tx = pool.begin().await.unwrap();
        let events = Store::events(&mut tx, id, 0).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(
            events.iter().map(|e| e.seq).collect::<Vec<_>>(),
            (1..=100).collect::<Vec<i32>>()
        );
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn runtime_kills_rows_larger_than_total_credits() {
    with_tables(|pool| async move {
        let recorder = Arc::new(Recorder::default());
        let mut registry = Registry::new();
        registry.register(Arc::new(Work(recorder.clone()))).unwrap();
        let mut big = new_op("rt.work", "big");
        big.cost = Some(20);
        big.run_after = Some(Utc::now() - TimeDelta::minutes(1));
        let big = enqueue(&pool, &big).await.id;
        let small = enqueue(&pool, &new_op("rt.work", "small")).await.id;

        let watch = pool.clone();
        let shutdown = async move {
            until(Duration::from_secs(10), || {
                let pool = watch.clone();
                async move {
                    count_state(&pool, "succeeded").await == 1
                        && count_state(&pool, "dead").await == 1
                }
            })
            .await;
        };
        worker::run(pool.clone(), registry, worker_config("rt/5"), shutdown)
            .await
            .unwrap();

        let op = get(&pool, big).await;
        assert_eq!((op.state, op.attempts), (State::Dead, 0));
        assert_eq!(
            op.last_error.as_deref(),
            Some("cost exceeds worker credits")
        );
        assert_eq!(get(&pool, small).await.state, State::Succeeded);
        assert_eq!(recorder.calls.lock().unwrap().clone(), vec![small]);
    })
    .await;
}

#[derive(Default)]
struct SlowDispatch {
    started: AtomicBool,
}

struct Slow(Arc<SlowDispatch>);

#[async_trait]
impl mark_ops::worker::Dispatcher for Slow {
    fn kind(&self) -> &'static str {
        "rt.push"
    }
    async fn send(&self, _: &mark_ops::OutboxItem) -> Result<(), HandlerError> {
        self.0.started.store(true, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(30)).await;
        Ok(())
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn runtime_releases_leases_when_drain_times_out() {
    with_tables(|pool| async move {
        let flags = Arc::new(SleepFlags::default());
        let slow = Arc::new(SlowDispatch::default());
        let mut registry = Registry::new();
        registry.register(Arc::new(Sleeper(flags.clone()))).unwrap();
        registry
            .register_dispatcher(Arc::new(Slow(slow.clone())))
            .unwrap();
        let id = enqueue(&pool, &new_op("rt.sleep", "k")).await.id;
        let mut tx = pool.begin().await.unwrap();
        let item = Store::outbox_add(&mut tx, "rt.push", &json!({}), None, None)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let mut config = worker_config("rt/6");
        config.dispatch_external_effects = true;
        config.drain = Duration::from_millis(200);
        let seen = flags.clone();
        let sending = slow.clone();
        let shutdown = async move {
            until(Duration::from_secs(10), || {
                let seen = seen.clone();
                let sending = sending.clone();
                async move {
                    seen.started.load(Ordering::SeqCst) && sending.started.load(Ordering::SeqCst)
                }
            })
            .await;
        };
        worker::run(pool.clone(), registry, config, shutdown)
            .await
            .unwrap();

        assert!(flags.dropped.load(Ordering::SeqCst), "handler not aborted");
        assert!(!flags.completed.load(Ordering::SeqCst));
        let op = get(&pool, id).await;
        assert_eq!((op.state, op.attempts), (State::Queued, 0));
        assert_eq!(op.last_error.as_deref(), Some("worker shutdown"));
        assert!(op.lease_owner.is_none() && op.run_after <= Utc::now());
        let (state, attempts, error, _, _) = outbox_row(&pool, item).await;
        assert_eq!((state.as_str(), attempts), ("pending", 0));
        assert_eq!(error.as_deref(), Some("worker shutdown"));
    })
    .await;
}
