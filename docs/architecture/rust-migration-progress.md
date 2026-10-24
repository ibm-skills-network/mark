# Rust migration progress

Running log of what has shipped, what is in flight, and the decisions that
changed the plan. Update this file in the same PR as the work it describes.
Plan: `rust-migration-master-plan.md`. Contracts: `contracts/`.

## Status by slice

| Slice | State | Where | Notes |
| --- | --- | --- | --- |
| Foundation (workspace, CI, images, chart, dark deploy) | Merged | #782, chart 1.4.16 | Verified on staging as `2.9.6-rust-rc1`; both services disabled by default. |
| Learner answer-key leak (TS fix ahead of the port) | Merged | #781 | Learner reads no longer carry version rows; visibility applied after submission only. |
| Learner load: contract | In progress | `contracts/learner-load.openapi.yaml` | Six routes, plain JSON, no base64, minimal explicit shapes. |
| Learner load: Rust routes | In progress | `rust/crates/api` | Principal from `user-session`, access checks, four reads, two writes. |
| Learner load: TypeScript parity | In progress | `apps/api` | Same contract from NestJS so the gateway can route either way. |
| Learner load: web | In progress | `apps/web` | Stop base64 decoding for these calls; tolerate null text; array `randomizedChoices`. |
| Learner load: gateway routing | In progress | `apps/api-gateway`, chart | Route families to rust-api by helm value. |
| Learner load: staging shadow reads | Not started | | Reads first, writes after ownership checks. |
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

## Open items

- `/languages` guard and `published` check on create are behaviour changes; both land with this slice in TS and Rust.
- Redis attempt-access cache: Rust does not use it. If latency on GET attempt matters, add a Rust-side cache with its own key prefix.
- Named prepared statements through pgbouncer are still unverified; sqlx statement cache stays off.
- Product decision: `correctAnswerVisibility` default is `ALWAYS`. Visibility now only applies after submission, so the default is safe, but authors may want `ON_PASS` as the default.
- Web UI must mark video/audio/live-recording question types as disabled (planned with the authoring slice).
