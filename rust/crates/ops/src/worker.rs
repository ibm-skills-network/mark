//! The worker loop: claim operations within a memory budget, run each under
//! a renewed lease, record the outcome, reap expired leases, and dispatch
//! outbox effects when allowed.
//!
//! Every statement runs in its own short transaction from the pool (see
//! `platform::db` for why a bare statement is unsafe behind pgbouncer).
//! Handlers must take connections briefly and never hold one across a
//! non-database await: the lease watchdog needs a connection every third of
//! a lease, and a starved watchdog loses the lease.
//!
//! Each claim gets its own `lease_owner` token (`<host>/<uuid>`), so fenced
//! writes belong to one claim, not to the process: if a lease expires and
//! the same pod claims the row again, the first run can no longer write.

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use sqlx::PgPool;
use tokio::sync::Notify;
use tokio::task::{Id, JoinSet};
use tokio::time::{Instant, MissedTickBehavior};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::store::{Operation, OutboxItem, Outcome, Store};

/// Long enough for a stack trace or provider message, short enough that a
/// runaway error cannot bloat the row.
const MAX_ERROR_LEN: usize = 2000;
/// Concurrent outbox sends per process; effects are network calls, not
/// memory-heavy work, so they sit outside the credit budget.
const OUTBOX_CONCURRENCY: usize = 4;
/// Retry delay when a dispatcher overruns its time box.
const OUTBOX_TIMEOUT_RETRY: Duration = Duration::from_secs(30);
/// How often undispatched effects are reported while dispatch is off.
const PENDING_WARN_EVERY: Duration = Duration::from_secs(60);
const IDLE_HEARTBEAT: Duration = Duration::from_secs(60);
/// The loop, a renewing watchdog and one handler write at the same time.
const MIN_POOL_CONNECTIONS: u32 = 3;

/// How a handler failed. The runtime turns it into a requeue or a dead row.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HandlerError {
    /// Transient: try again after `after`, while attempts remain.
    #[error("retry in {after:?}: {reason}")]
    Retry { after: Duration, reason: String },
    /// Retrying cannot help; the operation goes straight to `dead`.
    #[error("permanent: {0}")]
    Permanent(String),
}

/// Runs one operation kind.
#[async_trait]
pub trait Handler: Send + Sync {
    fn kind(&self) -> &'static str;
    async fn run(&self, ctx: &Ctx, op: &Operation) -> Result<(), HandlerError>;
}

/// Delivers one outbox kind.
#[async_trait]
pub trait Dispatcher: Send + Sync {
    fn kind(&self) -> &'static str;
    async fn send(&self, item: &OutboxItem) -> Result<(), HandlerError>;
}

/// What a running handler gets from the runtime.
#[derive(Debug, Clone)]
pub struct Ctx {
    pool: PgPool,
    owner: Arc<str>,
    operation_id: Uuid,
    lost: Arc<AtomicBool>,
}

impl Ctx {
    /// Short-lived connections only: begin, write, commit.
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// This claim's lease token; use it to fence the handler's own writes.
    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn operation_id(&self) -> Uuid {
        self.operation_id
    }

    /// Append a progress event, fenced on this claim's lease. Once the lease
    /// is gone nothing is written, because the operation belongs to someone
    /// else.
    pub async fn progress(
        &self,
        stage: &str,
        percent: Option<i16>,
        message: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        if self.lease_lost() {
            debug!(operation_id = %self.operation_id, owner = %self.owner, stage, "lease lost; progress not recorded");
            return Ok(());
        }
        if !progress(
            &self.pool,
            self.operation_id,
            &self.owner,
            stage,
            percent,
            message,
        )
        .await?
        {
            debug!(operation_id = %self.operation_id, owner = %self.owner, stage, "lease gone; progress not recorded");
        }
        Ok(())
    }

    /// Set when the watchdog found the lease gone. The handler is aborted
    /// right after, so this is mostly for code that must check before a
    /// side effect.
    pub fn lease_lost(&self) -> bool {
        self.lost.load(Ordering::Acquire)
    }
}

/// Handlers and dispatchers by kind.
#[derive(Default)]
pub struct Registry {
    handlers: HashMap<&'static str, Arc<dyn Handler>>,
    dispatchers: HashMap<&'static str, Arc<dyn Dispatcher>>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Two handlers for one kind is a wiring bug, so it is an error rather
    /// than a silent replacement.
    pub fn register(&mut self, handler: Arc<dyn Handler>) -> anyhow::Result<()> {
        let kind = handler.kind();
        if self.handlers.insert(kind, handler).is_some() {
            anyhow::bail!("handler for {kind} registered twice");
        }
        Ok(())
    }

    pub fn register_dispatcher(&mut self, dispatcher: Arc<dyn Dispatcher>) -> anyhow::Result<()> {
        let kind = dispatcher.kind();
        if self.dispatchers.insert(kind, dispatcher).is_some() {
            anyhow::bail!("dispatcher for {kind} registered twice");
        }
        Ok(())
    }

    /// Registered operation kinds, sorted.
    pub fn kinds(&self) -> Vec<String> {
        sorted(self.handlers.keys())
    }

    /// Registered outbox kinds, sorted.
    pub fn dispatcher_kinds(&self) -> Vec<String> {
        sorted(self.dispatchers.keys())
    }
}

fn sorted<'a>(keys: impl Iterator<Item = &'a &'static str>) -> Vec<String> {
    let mut kinds: Vec<String> = keys.map(|k| (*k).to_owned()).collect();
    kinds.sort();
    kinds
}

impl fmt::Debug for Registry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Registry")
            .field("handlers", &self.kinds())
            .field("dispatchers", &self.dispatcher_kinds())
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerConfig {
    /// Prefix of every lease token; the pod name, so an operator can trace
    /// `lease_owner` on a stuck row back to a pod.
    pub host: String,
    /// Memory budget: the sum of `cost` over running operations.
    pub credits: i32,
    /// `None` claims every registered kind.
    pub kinds: Option<Vec<String>>,
    pub lease: Duration,
    /// Pause after a poll that claimed something.
    pub busy_poll: Duration,
    /// Pause after a poll that claimed nothing.
    pub idle_poll: Duration,
    pub reap_every: Duration,
    pub consume_work: bool,
    pub dispatch_external_effects: bool,
    /// How long shutdown waits for running operations before aborting them
    /// and handing their rows back to the queue.
    pub drain: Duration,
}

impl WorkerConfig {
    pub fn from_config(config: &mark_platform::Config) -> anyhow::Result<Self> {
        let host = std::env::var("HOSTNAME")
            .ok()
            .filter(|h| !h.is_empty())
            .unwrap_or_else(|| config.service_name.clone());
        Ok(Self {
            host,
            credits: i32::try_from(config.worker.credits)?,
            kinds: config.worker.kinds.clone(),
            lease: config.worker.lease,
            busy_poll: Duration::from_secs(1),
            idle_poll: Duration::from_secs(5),
            reap_every: Duration::from_secs(30),
            consume_work: config.controls.consume_work,
            dispatch_external_effects: config.controls.dispatch_external_effects,
            drain: config.shutdown_grace,
        })
    }
}

/// Run until `shutdown` resolves, then drain.
pub async fn run(
    pool: PgPool,
    registry: Registry,
    config: WorkerConfig,
    shutdown: impl Future<Output = ()>,
) -> anyhow::Result<()> {
    let mut shutdown = std::pin::pin!(shutdown);

    if !config.consume_work {
        info!(host = %config.host, "consume_work is disabled; worker will not claim operations");
        let mut tick = tokio::time::interval(IDLE_HEARTBEAT);
        loop {
            tokio::select! {
                () = &mut shutdown => break,
                _ = tick.tick() => debug!(consume_work = false, "worker heartbeat"),
            }
        }
        info!("worker loop stopping");
        return Ok(());
    }

    let max_connections = pool.options().get_max_connections();
    if max_connections < MIN_POOL_CONNECTIONS {
        warn!(
            max_connections,
            min = MIN_POOL_CONNECTIONS,
            "database pool is too small for the worker; lease renewals may starve"
        );
    }

    let mut runner = Runner::new(pool, registry, config);
    let mut next_reap = Instant::now();
    let mut next_pending_warn = Instant::now();
    loop {
        runner.collect_finished();

        let now = Instant::now();
        if now >= next_reap {
            reap(&runner.pool, runner.config.lease).await;
            next_reap = now + runner.config.reap_every;
        }

        let mut claimed = runner.claim_operations().await;
        if runner.config.dispatch_external_effects {
            claimed += runner.claim_outbox().await;
        } else if now >= next_pending_warn {
            report_pending(&runner.pool).await;
            next_pending_warn = now + PENDING_WARN_EVERY;
        }

        let pause = if claimed > 0 {
            runner.config.busy_poll
        } else {
            runner.config.idle_poll
        };
        tokio::select! {
            () = &mut shutdown => break,
            () = tokio::time::sleep(pause) => {}
            () = runner.wake.notified() => {}
        }
    }
    runner.drain().await;
    Ok(())
}

/// A claim the loop has handed to a task.
struct Claimed {
    id: Uuid,
    owner: Arc<str>,
    cost: i32,
}

/// State of the claim loop.
struct Runner {
    pool: PgPool,
    config: WorkerConfig,
    kinds: Vec<String>,
    outbox_kinds: Vec<String>,
    handlers: HashMap<&'static str, Arc<dyn Handler>>,
    dispatchers: HashMap<&'static str, Arc<dyn Dispatcher>>,
    wake: Arc<Notify>,
    ops: JoinSet<()>,
    /// Keyed by task, so credits come back and leases can be released even
    /// if a task dies.
    running: HashMap<Id, Claimed>,
    sends: JoinSet<()>,
    sending: HashMap<Id, Claimed>,
}

impl Runner {
    fn new(pool: PgPool, registry: Registry, config: WorkerConfig) -> Self {
        let kinds = effective_kinds(&registry, config.kinds.as_deref());
        let outbox_kinds = registry.dispatcher_kinds();
        info!(
            host = %config.host,
            credits = config.credits,
            kinds = ?kinds,
            outbox_kinds = ?outbox_kinds,
            lease_ms = millis(config.lease),
            dispatch_external_effects = config.dispatch_external_effects,
            "worker loop starting"
        );
        if kinds.is_empty() {
            warn!(host = %config.host, "no operation kinds to claim; polling and reaping only");
        }
        Self {
            pool,
            config,
            kinds,
            outbox_kinds,
            handlers: registry.handlers,
            dispatchers: registry.dispatchers,
            wake: Arc::new(Notify::new()),
            ops: JoinSet::new(),
            running: HashMap::new(),
            sends: JoinSet::new(),
            sending: HashMap::new(),
        }
    }

    fn used_credits(&self) -> i32 {
        self.running.values().map(|c| c.cost).sum()
    }

    fn collect_finished(&mut self) {
        while let Some(done) = self.ops.try_join_next_with_id() {
            let id = match done {
                Ok((id, ())) => id,
                Err(e) => {
                    error!(error = %e, "operation task ended abnormally");
                    e.id()
                }
            };
            self.running.remove(&id);
        }
        while let Some(done) = self.sends.try_join_next_with_id() {
            let id = match done {
                Ok((id, ())) => id,
                Err(e) => {
                    error!(error = %e, "outbox task ended abnormally");
                    e.id()
                }
            };
            self.sending.remove(&id);
        }
    }

    /// One claim with whatever credits are free; returns how many started.
    async fn claim_operations(&mut self) -> usize {
        let budget = self.config.credits - self.used_credits();
        if self.kinds.is_empty() || budget <= 0 {
            return 0;
        }
        let batch = match claim(
            &self.pool,
            &self.config.host,
            &self.kinds,
            budget,
            self.config.lease,
        )
        .await
        {
            Ok(batch) => batch,
            Err(error) => {
                warn!(%error, host = %self.config.host, "claim failed");
                return 0;
            }
        };
        if batch.is_empty() {
            self.kill_oversized().await;
            return 0;
        }
        let claimed = batch.len();
        for op in batch {
            let owner: Arc<str> = Arc::from(op.lease_owner.as_deref().unwrap_or_default());
            let Some(handler) = self.handlers.get(op.kind.as_str()).cloned() else {
                // Only registered kinds are claimed; this is a safety net,
                // and the lease will be reaped.
                error!(operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "claimed", "claimed an operation with no handler");
                continue;
            };
            let claimed = Claimed {
                id: op.id,
                owner: owner.clone(),
                cost: op.cost,
            };
            let task = execute(
                self.pool.clone(),
                handler,
                op,
                owner,
                self.config.lease,
                self.wake.clone(),
            );
            let abort = self.ops.spawn(task);
            self.running.insert(abort.id(), claimed);
        }
        claimed
    }

    /// A head row costing more than the whole budget would block its kinds
    /// forever on this worker, so it is failed loudly instead.
    async fn kill_oversized(&self) {
        let result = async {
            let mut tx = self.pool.begin().await?;
            let killed = Store::kill_oversized(&mut tx, &self.kinds, self.config.credits).await?;
            tx.commit().await?;
            Ok::<_, sqlx::Error>(killed)
        }
        .await;
        match result {
            Ok(None) => {}
            Ok(Some((id, kind, key, cost))) => {
                warn!(operation_id = %id, %kind, %key, cost, credits = self.config.credits, host = %self.config.host, stage = "dead", "operation cost exceeds worker credits; marked dead");
            }
            Err(error) => warn!(%error, host = %self.config.host, "oversized check failed"),
        }
    }

    async fn claim_outbox(&mut self) -> usize {
        let free = OUTBOX_CONCURRENCY.saturating_sub(self.sends.len());
        if self.outbox_kinds.is_empty() || free == 0 {
            return 0;
        }
        let batch = match claim_outbox(
            &self.pool,
            &self.config.host,
            &self.outbox_kinds,
            free,
            self.config.lease,
        )
        .await
        {
            Ok(batch) => batch,
            Err(error) => {
                warn!(%error, host = %self.config.host, "outbox claim failed");
                return 0;
            }
        };
        let claimed = batch.len();
        for item in batch {
            let owner: Arc<str> = Arc::from(item.lease_owner.as_deref().unwrap_or_default());
            if let Some(dispatcher) = self.dispatchers.get(item.kind.as_str()).cloned() {
                let claimed = Claimed {
                    id: item.id,
                    owner: owner.clone(),
                    cost: 0,
                };
                let abort = self.sends.spawn(dispatch(
                    self.pool.clone(),
                    dispatcher,
                    item,
                    owner,
                    self.config.lease,
                    self.wake.clone(),
                ));
                self.sending.insert(abort.id(), claimed);
            }
        }
        claimed
    }

    async fn join_all(&mut self) {
        while let Some(done) = self.ops.join_next_with_id().await {
            if let Ok((id, ())) = done {
                self.running.remove(&id);
            }
        }
        while let Some(done) = self.sends.join_next_with_id().await {
            if let Ok((id, ())) = done {
                self.sending.remove(&id);
            }
        }
    }

    async fn drain(mut self) {
        let host = self.config.host.clone();
        info!(host = %host, running = self.ops.len(), sending = self.sends.len(), "worker loop stopping; draining");
        let drained = tokio::time::timeout(self.config.drain, self.join_all()).await;
        if drained.is_err() {
            warn!(
                host = %host,
                running = self.ops.len(),
                sending = self.sends.len(),
                "drain timed out; aborting and releasing leases"
            );
            self.ops.abort_all();
            self.sends.abort_all();
            self.join_all().await;
            self.release_leases().await;
        }
        info!(host = %host, "worker loop stopped");
    }

    /// Hand aborted claims back to the queue now, attempt refunded, rather
    /// than leaving them for the reaper. Fenced, so a claim that finished
    /// after all is untouched.
    async fn release_leases(&mut self) {
        for claimed in self.running.values() {
            let result = async {
                let mut tx = self.pool.begin().await?;
                let released = Store::release(&mut tx, claimed.id, &claimed.owner).await?;
                tx.commit().await?;
                Ok::<_, sqlx::Error>(released)
            }
            .await;
            match result {
                Ok(released) => {
                    info!(operation_id = %claimed.id, owner = %claimed.owner, released, stage = "released", "operation lease released at shutdown");
                }
                Err(error) => {
                    warn!(%error, operation_id = %claimed.id, owner = %claimed.owner, stage = "released", "releasing lease failed; the reaper will take it");
                }
            }
        }
        for claimed in self.sending.values() {
            let result = async {
                let mut tx = self.pool.begin().await?;
                let released = Store::outbox_release(&mut tx, claimed.id, &claimed.owner).await?;
                tx.commit().await?;
                Ok::<_, sqlx::Error>(released)
            }
            .await;
            match result {
                Ok(released) => {
                    info!(outbox_id = %claimed.id, owner = %claimed.owner, released, stage = "released", "outbox lease released at shutdown");
                }
                Err(error) => {
                    warn!(%error, outbox_id = %claimed.id, owner = %claimed.owner, stage = "released", "releasing outbox lease failed; the reaper will take it");
                }
            }
        }
        self.running.clear();
        self.sending.clear();
    }
}

fn millis(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

/// Configured kinds narrowed to those with a handler: claiming a kind this
/// process cannot run would only leave it leased until the reaper.
fn effective_kinds(registry: &Registry, configured: Option<&[String]>) -> Vec<String> {
    let registered = registry.kinds();
    match configured {
        None => registered,
        Some(wanted) => {
            let (kept, missing): (Vec<String>, Vec<String>) =
                wanted.iter().cloned().partition(|k| registered.contains(k));
            if !missing.is_empty() {
                warn!(kinds = ?missing, "configured kinds have no handler in this build; not claiming them");
            }
            kept
        }
    }
}

async fn claim(
    pool: &PgPool,
    host: &str,
    kinds: &[String],
    budget: i32,
    lease: Duration,
) -> Result<Vec<Operation>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Minimum cost is 1, so the budget is also the most rows that can fit.
    let batch = Store::claim(&mut tx, host, kinds, budget, budget, lease).await?;
    tx.commit().await?;
    Ok(batch)
}

async fn claim_outbox(
    pool: &PgPool,
    host: &str,
    kinds: &[String],
    free: usize,
    lease: Duration,
) -> Result<Vec<OutboxItem>, sqlx::Error> {
    let limit = i32::try_from(free).unwrap_or(i32::MAX);
    let mut tx = pool.begin().await?;
    let batch = Store::outbox_claim(&mut tx, host, kinds, limit, lease).await?;
    tx.commit().await?;
    Ok(batch)
}

/// Grace equal to one lease: a renewal already in flight when the lease
/// ran out gets a full period to land before the row is taken back.
async fn reap(pool: &PgPool, grace: Duration) {
    let result = async {
        let mut tx = pool.begin().await?;
        let ops = Store::reap(&mut tx, grace).await?;
        let outbox = Store::outbox_reap(&mut tx, grace).await?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>((ops, outbox))
    }
    .await;
    match result {
        Ok((0, 0)) => debug!("reaper found no expired leases"),
        Ok((operations, outbox)) => {
            warn!(
                operations,
                outbox,
                stage = "reaped",
                "released expired leases"
            );
        }
        Err(error) => warn!(%error, "reaper failed"),
    }
}

async fn report_pending(pool: &PgPool) {
    let result = async {
        let mut tx = pool.begin().await?;
        let n = Store::outbox_pending(&mut tx).await?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>(n)
    }
    .await;
    match result {
        Ok(0) => {}
        Ok(pending) => warn!(
            pending,
            "external effects are pending but dispatch_external_effects is disabled"
        ),
        Err(error) => warn!(%error, "counting pending outbox rows failed"),
    }
}

/// `false` when the lease is gone and nothing was written.
async fn progress(
    pool: &PgPool,
    id: Uuid,
    owner: &str,
    stage: &str,
    percent: Option<i16>,
    message: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let seq = Store::progress(&mut tx, id, owner, stage, percent, message, None).await?;
    tx.commit().await?;
    Ok(seq.is_some())
}

fn truncate(s: &str) -> &str {
    if s.len() <= MAX_ERROR_LEN {
        return s;
    }
    let mut end = MAX_ERROR_LEN;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Aborts the handler task when the owning task is dropped (shutdown abort),
/// so a handler never outlives the code that would record its outcome.
struct AbortOnDrop(tokio::task::AbortHandle);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn execute(
    pool: PgPool,
    handler: Arc<dyn Handler>,
    op: Operation,
    owner: Arc<str>,
    lease: Duration,
    wake: Arc<Notify>,
) {
    info!(operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "claimed", cost = op.cost, "operation claimed");
    match progress(&pool, op.id, &owner, "claimed", None, None).await {
        Ok(true) => {}
        Ok(false) => {
            warn!(operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "lease_lost", "lease gone before the handler started");
            wake.notify_one();
            return;
        }
        Err(error) => {
            warn!(%error, operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "claimed", "recording claimed event failed");
        }
    }

    let ctx = Ctx {
        pool: pool.clone(),
        owner: owner.clone(),
        operation_id: op.id,
        lost: Arc::new(AtomicBool::new(false)),
    };
    match run_under_lease(&ctx, handler, &op, lease).await {
        None => {
            warn!(operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "lease_lost", "lease lost; handler aborted, nothing recorded");
        }
        Some(result) => {
            if let Err(error) = finish(&pool, &op, &owner, result).await {
                error!(%error, operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "finish", "recording the outcome failed; the lease will be reaped");
            }
        }
    }
    wake.notify_one();
}

/// `None` when the lease was lost and the handler aborted.
async fn run_under_lease(
    ctx: &Ctx,
    handler: Arc<dyn Handler>,
    op: &Operation,
    lease: Duration,
) -> Option<Result<(), HandlerError>> {
    let task_ctx = ctx.clone();
    let task_op = op.clone();
    // A separate task so a panicking handler becomes a failure rather than
    // taking the runtime's bookkeeping down with it.
    let mut handle = tokio::spawn(async move { handler.run(&task_ctx, &task_op).await });
    let _guard = AbortOnDrop(handle.abort_handle());

    tokio::select! {
        joined = &mut handle => Some(match joined {
            Ok(result) => result,
            Err(e) if e.is_panic() => {
                Err(HandlerError::Permanent("handler panicked".to_owned()))
            }
            Err(e) => Err(HandlerError::Permanent(format!("handler task failed: {e}"))),
        }),
        () = watch_lease(ctx, lease) => {
            ctx.lost.store(true, Ordering::Release);
            handle.abort();
            None
        }
    }
}

/// A lease not renewed for a full lease period may already belong to
/// someone else, whatever the reason the renewals failed.
fn lease_expired(last_renewed: Instant, now: Instant, lease: Duration) -> bool {
    now > last_renewed + lease
}

/// Renews every third of the lease; returns only when the lease is gone:
/// renewal says it is not ours, or renewals have failed for a whole lease.
async fn watch_lease(ctx: &Ctx, lease: Duration) {
    let every = (lease / 3).max(Duration::from_millis(100));
    let mut last_renewed = Instant::now();
    let mut tick = tokio::time::interval_at(Instant::now() + every, every);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        let attempt_started = Instant::now();
        let renewed = async {
            let mut tx = ctx.pool.begin().await?;
            let ok = Store::renew(&mut tx, ctx.operation_id, &ctx.owner, lease).await?;
            tx.commit().await?;
            Ok::<_, sqlx::Error>(ok)
        }
        .await;
        match renewed {
            Ok(true) => {
                last_renewed = attempt_started;
                debug!(operation_id = %ctx.operation_id, owner = %ctx.owner, "lease renewed");
            }
            Ok(false) => return,
            Err(error) => {
                if lease_expired(last_renewed, Instant::now(), lease) {
                    warn!(%error, operation_id = %ctx.operation_id, owner = %ctx.owner, "lease renewals failed for a full lease; treating it as lost");
                    return;
                }
                warn!(%error, operation_id = %ctx.operation_id, owner = %ctx.owner, "lease renewal failed; retrying");
            }
        }
    }
}

async fn finish(
    pool: &PgPool,
    op: &Operation,
    owner: &str,
    result: Result<(), HandlerError>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    match result {
        Ok(()) => {
            // The fenced update holds the row lock, so the unfenced event
            // insert after it cannot race another writer.
            if !Store::succeed(&mut tx, op.id, owner).await? {
                tx.rollback().await?;
                warn!(operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "lease_lost", "lease lost before success was recorded");
                return Ok(());
            }
            Store::event(&mut tx, op.id, "done", Some(100), None, None).await?;
            tx.commit().await?;
            info!(operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "done", "operation succeeded");
        }
        Err(failure) => {
            let (reason, retry_in) = match &failure {
                HandlerError::Retry { after, reason } => (truncate(reason), Some(*after)),
                HandlerError::Permanent(reason) => (truncate(reason), None),
            };
            let outcome = Store::fail(&mut tx, op.id, owner, reason, retry_in).await?;
            if outcome == Outcome::LeaseLost {
                tx.rollback().await?;
                warn!(operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "lease_lost", "lease lost before failure was recorded");
                return Ok(());
            }
            Store::event(&mut tx, op.id, "error", None, Some(reason), None).await?;
            tx.commit().await?;
            match outcome {
                Outcome::Requeued { run_after } => {
                    warn!(operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "error", %run_after, error = reason, "operation failed; requeued");
                }
                Outcome::Dead | Outcome::LeaseLost => {
                    error!(operation_id = %op.id, kind = %op.kind, key = %op.key, attempt = op.attempts, owner = %owner, stage = "error", error = reason, "operation failed; dead");
                }
            }
        }
    }
    Ok(())
}

async fn dispatch(
    pool: PgPool,
    dispatcher: Arc<dyn Dispatcher>,
    item: OutboxItem,
    owner: Arc<str>,
    lease: Duration,
    wake: Arc<Notify>,
) {
    // Outbox leases are not renewed, so a send must finish well inside one.
    let result = match tokio::time::timeout(lease / 2, dispatcher.send(&item)).await {
        Ok(result) => result,
        Err(_) => Err(HandlerError::Retry {
            after: OUTBOX_TIMEOUT_RETRY,
            reason: "dispatch timed out".to_owned(),
        }),
    };
    let recorded = async {
        let mut tx = pool.begin().await?;
        let outcome = match &result {
            Ok(()) => {
                if Store::outbox_sent(&mut tx, item.id, &owner).await? {
                    None
                } else {
                    Some(Outcome::LeaseLost)
                }
            }
            Err(HandlerError::Retry { after, reason }) => Some(
                Store::outbox_fail(&mut tx, item.id, &owner, truncate(reason), Some(*after))
                    .await?,
            ),
            Err(HandlerError::Permanent(reason)) => {
                Some(Store::outbox_fail(&mut tx, item.id, &owner, truncate(reason), None).await?)
            }
        };
        tx.commit().await?;
        Ok::<_, sqlx::Error>(outcome)
    }
    .await;
    let operation_id = item.operation_id.map(|id| id.to_string());
    match recorded {
        Ok(None) => {
            info!(outbox_id = %item.id, operation_id, kind = %item.kind, attempt = item.attempts, owner = %owner, stage = "sent", "external effect sent");
        }
        Ok(Some(Outcome::Requeued { run_after })) => {
            warn!(outbox_id = %item.id, operation_id, kind = %item.kind, attempt = item.attempts, owner = %owner, stage = "error", %run_after, "external effect failed; retrying");
        }
        Ok(Some(Outcome::Dead)) => {
            error!(outbox_id = %item.id, operation_id, kind = %item.kind, attempt = item.attempts, owner = %owner, stage = "error", "external effect failed; dead");
        }
        Ok(Some(Outcome::LeaseLost)) => {
            warn!(outbox_id = %item.id, operation_id, kind = %item.kind, attempt = item.attempts, owner = %owner, stage = "lease_lost", "outbox lease lost; outcome not recorded");
        }
        Err(error) => {
            error!(%error, outbox_id = %item.id, operation_id, kind = %item.kind, attempt = item.attempts, owner = %owner, stage = "finish", "recording the outbox outcome failed; the lease will be reaped");
        }
    }
    wake.notify_one();
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Noop(&'static str);

    #[async_trait]
    impl Handler for Noop {
        fn kind(&self) -> &'static str {
            self.0
        }
        async fn run(&self, _: &Ctx, _: &Operation) -> Result<(), HandlerError> {
            Ok(())
        }
    }

    #[test]
    fn registry_rejects_duplicates_and_sorts() {
        let mut r = Registry::new();
        assert!(r.register(Arc::new(Noop("b.kind"))).is_ok());
        assert!(r.register(Arc::new(Noop("a.kind"))).is_ok());
        assert!(r.register(Arc::new(Noop("a.kind"))).is_err());
        assert_eq!(r.kinds(), vec!["a.kind".to_owned(), "b.kind".to_owned()]);
        assert!(format!("{r:?}").contains("a.kind"));
    }

    #[test]
    fn configured_kinds_are_narrowed_to_registered() {
        let mut r = Registry::new();
        assert!(r.register(Arc::new(Noop("a.kind"))).is_ok());
        assert_eq!(effective_kinds(&r, None), vec!["a.kind".to_owned()]);
        let wanted = vec!["a.kind".to_owned(), "missing".to_owned()];
        assert_eq!(
            effective_kinds(&r, Some(&wanted)),
            vec!["a.kind".to_owned()]
        );
        assert!(effective_kinds(&Registry::new(), None).is_empty());
    }

    #[test]
    fn truncate_respects_char_boundaries() {
        let long = "é".repeat(MAX_ERROR_LEN);
        let cut = truncate(&long);
        assert!(cut.len() <= MAX_ERROR_LEN);
        assert!(long.starts_with(cut));
        assert_eq!(truncate("short"), "short");
    }

    #[test]
    fn failed_renewals_lose_the_lease_after_one_period() {
        let start = Instant::now();
        let lease = Duration::from_secs(3);
        assert!(!lease_expired(start, start + Duration::from_secs(2), lease));
        assert!(!lease_expired(start, start + lease, lease));
        assert!(lease_expired(
            start,
            start + lease + Duration::from_millis(1),
            lease
        ));
    }
}
