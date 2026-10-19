# Rich text migration

This is a manually operated job. API startup and Helm deployment do not start it. It stores canonical HTML, preserves response/draft envelopes, and uses the shared viewer sanitizer policy. Unknown markup, unsafe sanitizer changes, ambiguous response types, and variant collisions require review. A response's type comes from its attempt's question version; attempts from before versioning use the question's current type. Quill's code-block language picker is editor chrome and is dropped.

## Build and deployment

`yarn --cwd apps/api build` builds the API and the standalone `dist/rich-text-migration/main.js` and `worker.js` bundles. The API image includes both. To build only the job:

```sh
yarn --cwd apps/api build:rich-text-migration
```

Deploy the additive Prisma migration `20261014190000_rich_text_migration_ledger` before using `plan`. A read-only audit needs no ledger tables. Give the worker its own connection through `RICH_TEXT_MIGRATION_DATABASE_URL`; it deliberately never falls back to the API's `DATABASE_URL`. A direct PostgreSQL connection is preferred. A transaction-mode pgbouncer also works: the job keeps every setting transaction-scoped (`SET LOCAL`, `SET TRANSACTION READ ONLY`) and uses a lease table rather than advisory locks or session state. Prefer a restricted maintenance role and protect ledger/backups as student data. Keep the image used to create each run through its rollback window.

The operator-only [Job example](job.example.yaml) is outside Helm templates. Replace its placeholders and use the appropriate namespace, service account, network policy, and database secret. Its applied-row cap persists across retries. Automatic retries use `apply`, which continues checkpoints but respects a paused run; reserve `resume` for explicitly unpausing. `apply` exits 0 when the run is already paused, and `apply`/`resume` exit 0 when it is paused while they run, so pausing does not consume the Job's retries. A pause that lands as the last row finishes leaves the run `paused`; `resume` it to record completion. A crashed worker's lease expires after 90 seconds, so the example allows enough backoff for that recovery. Never add this conversion to an automatic schema-migration hook.

## Commands

Run commands from the API image working directory. The connection secret must already be supplied through the environment; do not put it in a shell command or log.

```sh
node dist/rich-text-migration/main.js audit --origin https://mark.staging.skills.network --scope all --report /protected/audit.json
node dist/rich-text-migration/main.js plan --origin https://mark.staging.skills.network --scope 123 --target AUDIT_TARGET
node dist/rich-text-migration/main.js apply --run RUN_ID --target AUDIT_TARGET --max-updates 10
node dist/rich-text-migration/main.js status --run RUN_ID --target AUDIT_TARGET
node dist/rich-text-migration/main.js pause --run RUN_ID --target AUDIT_TARGET
node dist/rich-text-migration/main.js resume --run RUN_ID --target AUDIT_TARGET --max-updates 10
node dist/rich-text-migration/main.js retry-conflicts --run RUN_ID --target AUDIT_TARGET
node dist/rich-text-migration/main.js verify --run RUN_ID --target AUDIT_TARGET
node dist/rich-text-migration/main.js rollback --run RUN_ID --target AUDIT_TARGET
```

The audit prints a target digest. Every subsequent command requires it. `plan` prints the run ID before discovery, so an interrupted inventory can resume. Plans scan all rows in their scope, including inactive versions and archived content. Discovery commits items and its cursor together in batches of at most 20 rows or 8 MiB. Nine models contain convertible editor fields; feedback translations and additional feedback, scoring, choices, metadata, and author comments are inventoried without rewriting them. Legacy HTML there requires explicit review and blocks retirement certification. Plan and apply use the same recorded converter, parser, dependency lock, Node runtime, database schema, scope, origin, and size limit. A changed build requires a new plan.

`--max-updates` defaults to 10 and means the total committed rows for that run, including previous executions. Raising it explicitly expands a canary; restarts do not. Scope a canary by assignment so it includes historical versions, draft question payloads, translations, and responses. `--scope all` creates a separate global run. Complete fresh audits include lower IDs edited since discovery and newly inserted rows; create a follow-up plan for newly found legacy records.

Progress and reasons contain identifiers and counts, never document bodies. stdout carries the JSON results; diagnostics are JSON lines on stderr (`RICH_TEXT_MIGRATION_LOG_LEVEL`, default `info`) with error names, database codes, and stack frames but never error messages from the database, which can quote row values. Pending, quarantined, conflicting, and exhausted retry items remain visible in `status`; a successful worker exit does not certify migration completion. A parser runs in an isolated worker with a 256 MiB heap and 10 second timeout. A timed-out or crashed parser is retried once in a fresh worker, then the item becomes `retryable` with backoff instead of quarantined. A document that crashes the parser every time (for example by exhausting its heap) exhausts its attempts and stays visible as `retryable` in `status`; review it rather than repeating `retry-conflicts`. Inputs/outputs default to a 4 MiB row budget. An oversized row requires a new plan with a reviewed `--max-document-bytes` limit, up to 32 MiB; data is never truncated.

Read-only audit has no database writes, including ledger writes. Its report file is created exclusively with mode `0600`. Every application-row change commits its original and replacement backup, integrity digests, and applied checkpoint together. Text is compared exactly against the validated source while the row is locked. Changes to a complete JSON column cause a conflict, avoiding overwriting another member. Existing business timestamps, grades, feedback, IDs, and version relationships are not updated.

Transient lock/deadlock failures get bounded retries. Exhausted retries require `retry-conflicts`, which also requeues parser timeouts quarantined by older builds. Deterministic quarantine does not automatically retry unchanged content. Edit/review the source or create a new run with the corrected converter. `retry-conflicts` revalidates changed source values and links their old items to successor items. Repeated source history requires a new run, preserving immutable applied checkpoints and backups. Deleted or out-of-scope rows are never recreated.

Rollback obtains the same database-wide lease as apply, verifies backup digests, and restores only fields that still equal their recorded replacement. Later edits remain untouched: a row whose every field was edited is a rollback `conflict`, and a row with some edited fields is `partial`, with its unedited fields restored. Both leave the run in `needs_review`. Repeat `rollback` to resume an interrupted rollback. A run that has begun rollback cannot resume application; use a new run afterward. Keep the original job image, application schema fingerprint, and runtime legacy compatibility available until the rollback window ends.

## Verification and retirement

`verify` performs a new complete audit and checks stored backup integrity. It reports exact replacement matches, later value changes, and deletions separately. It refuses completion while its ledger has unresolved items or the audit finds remaining convertible or quarantined documents.

The job does not automatically deploy server write guards, modify browser drafts, invalidate application-specific caches, or remove compatibility. Before retirement, test and close all author/submission/import/restore/translation write paths, drain older writers, handle older browser drafts without discarding answers, and validate warm/cold editor and viewer reads. Run a staging crash/resume/rollback exercise and a production canary first. Preserve ordinary sanitization and canonical TipTap CSS/extensions.

Only after those prerequisites pass, attest them explicitly and run verification twice:

```sh
node dist/rich-text-migration/main.js verify --run RUN_ID --target AUDIT_TARGET --write-boundary-confirmed --canary-approved
```

Without both attestations, audits do not accumulate retirement certification. Scoped runs can become `canary_verified`; only an all-record run can report `retirementReady: true`. The attestations are operator evidence requirements, not automatic checks of the application write paths. Retain compatibility through the rollback window and normalize old database backups before reopening traffic after a restore.

## Tests

```sh
yarn --cwd apps/api jest --runInBand --runTestsByPath maintenance/rich-text-normalization/converter.spec.ts
```

The PostgreSQL suite requires an empty disposable database named `mark_rich_text_migration_test_<suffix>` on localhost. It rejects other targets. Supply its connection through `RICH_TEXT_MIGRATION_TEST_URL`, then run:

```sh
yarn --cwd apps/api jest --runInBand --runTestsByPath maintenance/rich-text-normalization/integration.spec.ts
```

The suite creates isolated fixtures and uses SIGKILL at each transaction boundary. It checks resume, duplicate execution, fencing, live edits, canary caps, collisions, rollback, untouched grades/timestamps, scope, and verification gates. It is skipped when the test URL is absent. The `Rich text migration recovery` CI job supplies a dedicated database, smoke-tests the built bundle, and runs these suites. Image build and deploy depend on it.
