//! Durable operations: background work as rows in Postgres, claimed with a
//! lease, with progress events and an outbox for external effects.
//!
//! [`store`] holds every statement; [`worker`] is the loop that claims and
//! runs operations through registered handlers.

pub mod store;
pub mod worker;

pub use store::{
    Enqueued, Event, NewOperation, Operation, OutboxItem, OutboxState, Outcome, State, Store,
};
pub use worker::{Ctx, Dispatcher, Handler, HandlerError, Registry, WorkerConfig};
