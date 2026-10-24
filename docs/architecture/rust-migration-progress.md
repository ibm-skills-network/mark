# Rust migration progress

Running log of what has shipped, what is in flight, and the decisions that
changed the plan. Update this file in the same PR as the work it describes.
Plan: `rust-migration-master-plan.md`. Contracts: `contracts/`.

## Status by slice

| Slice | State | Where | Notes |
| --- | --- | --- | --- |
| Foundation (workspace, CI, images, chart, dark deploy) | Merged | #782, chart 1.4.16 | Verified on staging as `2.9.6-rust-rc1`; both services disabled by default. |
| Learner answer-key leak (TS fix ahead of the port) | Merged | #781 | Learner reads no longer carry version rows; visibility applied after submission only. |
| Learner load: contract | Done on branch | `contracts/learner-load.openapi.yaml` | Six routes, plain JSON, no base64, minimal explicit shapes. |
| Learner load: Rust routes | Done on branch | `rust/crates/learner`, mounted by `mark-api` at `/api/v2` | Principal from `user-session`, access checks, four reads, two writes behind `accept_operations`. Exercised against a migrated Postgres locally. |
| Learner load: TypeScript parity | Done on branch | `apps/api` | Same contract from NestJS. Found and fixed `@DataTransform` never applying (wrong metadata target). |
| Learner load: web | Done on branch | `apps/web` | No decoding for these calls; null text tolerated; array `randomizedChoices`; unpublished message; languages fallback to `en`. |
| Learner load: gateway routing | Done on branch | `apps/api-gateway`, chart 1.4.17 | `rustApi.routes` lists families (`learner-reads`, `learner-attempt-writes`); learners only; `x-mark-backend` header. |
| Learner load: staging shadow reads | Verified 2026-10-24 | staging `2.10.0-rc2`, chart 1.4.17, `routes: [learner-reads]` | All eight learner reads on two assignments byte-identical to TypeScript (ignoring `serverNow`); 1,648 benchmark requests, zero errors; zero pgbouncer errors after the transaction-pinning fix. |
| Attempt autosave / submit / grading | Not started | | Next slice after learner load. |

## Decisions log

- 2026-10-22 Noah: SIMPLIFY is the goal. Axe video/audio/live recording, v1 assignment API, chat extras, LLM pricing admin, admin stats, Flo, GitHub OAuth picker. Confirm usage before removing anything marked "confirm".
- 2026-10-23 Noah: attempt and time limits are authoritative on the base `Assignment` row, not the version.
- 2026-10-23 Noah: every Rust API change ships with the matching TypeScript change in the same PR so cutover is a routing flip.
- 2026-10-23: branching. `master-rust` retired once the foundation merged. Rust work goes on `rust/<feature>` branches straight to master; Rust code is inert on master because the chart disables it and the execution switches default off.
- 2026-10-23: mixed mode is a gateway routing problem. One gateway, one database (Prisma owns the schema), two api deployments, two worker deployments, and a helm list of route families served by Rust. Rollback is a values change.
- 2026-10-24: the create-attempt advisory lock stays. `pg_advisory_xact_lock` is transaction-scoped, released at commit, and therefore safe behind pgbouncer in transaction mode; the CLAUDE.md ban is for session-level locks from ad-hoc psql. Keeping it also serialises NestJS and Rust creators against each other during coexistence. The earlier idea of a partial unique index does not work because "active" depends on `expiresAt` versus now.
- 2026-10-24: reads first. Rust owns `GET assignment`, `GET languages`, `GET attempts`, `GET attempt` when routed; `POST attempts` and `POST abandon` are implemented but stay on TypeScript until the read routes have run a cycle on staging.
- 2026-10-24: deploy image tags are release tags only (`X.Y.Z-rcN`), never branch or commit tags.
- 2026-10-24: on GET attempt, `choices` are always `{id, choice}`; `isCorrect`/`feedback` appear only on `randomizedChoices` and `translatedChoices` items after submission when visibility allows. Matches legacy behaviour and the completed-attempt route.

## Review findings, learner-load slice (2026-10-24)

An independent divergence review of the two implementations found 24 items. Fixed in this slice:

- TypeScript guards accepted a session with no `groupId` (Prisma drops an undefined filter, so any group's link granted access) and let a learner with no `userId` resume any learner's active attempt on create. Both now refuse with 403 before querying; Rust already did.
- Route ids no longer fall back to the session's assignment id; ids outside the i32 range are rejected before the query instead of surfacing as 500.
- `user-session` header must be an object with string fields; anything else is 400 on both sides.
- Attempt-read shaping: `choices` never carry `feedback`; revealed `randomizedChoices` and `translatedChoices` always carry `feedback` (null when absent); `scoring` omitted when stored null; `maxWords`/`maxCharacters` of 0 kept; translation keys limited to the requested family; frozen order applied to translated choices only when it covers every choice.
- Learner assignment view: `published` and `showAssignmentScore` from the base row; cooldown default 0 to match enforcement; `questionControls` parsed when stored as a string.
- Rust: whole floats as integers; writes-off answers the standard 503 with `Retry-After`; version rows with a null `questionId` no longer pick up an unrelated question's variants.
- TypeScript: P2028/P2034 map to 503; `Prisma.DbNull` for unusable frozen choices; deterministic `ORDER BY id` on the pools the seeded shuffle consumes.

Accepted differences: Express adds ETag/304 and helmet headers and `charset=utf-8`; Rust does not. Author responses never reach Rust (gateway routes learners only). Choice shuffle distribution differs (legacy sort-random is biased) but not any single response's bytes.

## Staging measurements, 2026-10-24 (rc2, same network path, same database)

Single-request p50 latency measured from inside the gateway pod:

| Route | TypeScript | Rust |
| --- | --- | --- |
| GET assignment | 303 ms | 48 ms |
| GET languages | 105 ms | 29 ms |
| GET attempts | 109 ms | 35 ms |
| GET attempt | 373 ms | 71 ms |

At ten concurrent clients TypeScript roughly doubles (608 ms p50 on GET assignment, 16 req/s) while Rust reaches 101 ms p50 at 92 req/s with no errors. Idle footprint: TypeScript api 398 MiB and 70 millicores; Rust api 2 MiB and 2 millicores. Rust requests are 128 MiB / 100m with limits 256 MiB / 500m. The rc1 build without transaction pinning failed a third of concurrent requests with pgbouncer unnamed-statement errors; rc2 failed none.

## Operating notes for the learner-load slice

- Routing a family to Rust needs `rustApi.enabled: true`, `rustApi.routes` listing the family, and `MARK_RUST_ACCEPT_OPERATIONS=true` on rust-api. With the switch off, the two POST routes answer 503 and the GET assignment group-link self-heal (a write) is skipped, so an unlinked learner would get 403 instead of being healed.
- Rust is stricter than legacy in a few places, on purpose: an empty `groupId` never matches a link row; authors must be scoped to the route assignment on every route; ids above i32 are rejected before the query. The create transaction sets `SET LOCAL lock_timeout = '10s'` (transaction-scoped, pgbouncer-safe) and maps a timeout to 503.
- CI's empty Postgres skips the SQL statement test in `rust/crates/learner/tests/sql_statements.rs`; run it against a migrated database (`DATABASE_URL` set) when changing `store.rs`.

## Open items

- `/languages` guard and `published` check on create are behaviour changes; both land with this slice in TS and Rust.
- Redis attempt-access cache: Rust does not use it. If latency on GET attempt matters, add a Rust-side cache with its own key prefix.
- Named prepared statements through pgbouncer are still unverified; sqlx statement cache stays off.
- 2026-10-24 staging finding: with the cache off, a bare pool query still sends two Syncs (Parse/Describe, then Bind/Execute), and pgbouncer in transaction mode can move the second half to another server connection: `unnamed prepared statement does not exist`. Seen on 22% of readiness pings on both Rust pods. Fix in this slice: simple-protocol ping, and every request's statements inside one transaction so pgbouncer pins the connection. Rule: never run a parameterised query straight on the pool; always inside a transaction.
- Product decision: `correctAnswerVisibility` default is `ALWAYS`. Visibility now only applies after submission, so the default is safe, but authors may want `ON_PASS` as the default.
- Web UI must mark video/audio/live-recording question types as disabled (planned with the authoring slice).
