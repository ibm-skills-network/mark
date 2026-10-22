# Immutable attempts (Part 03)

Implementation is available on `part2`. Production routing is **disabled by default**. The first supported end-to-end cohort is CHOICE-01: new, choice-only attempts created explicitly with this API. Existing attempts and the current learner UI retain the legacy contract. This is not evidence of a deployed migration or live LMS verification.

## Commands and invariants

All paths below are relative to version 2 `assignments/:assignmentId/attempts`. The existing signed-session role, assignment/group and attempt ownership guard applies. The service independently checks the route assignment and owner for every draft/submission command. Older controllers reject pinned attempts with 409; database triggers additionally reject legacy result/response writes.

| Request | Body | Durable outcome |
| --- | --- | --- |
| `POST snapshot` | `{ "operationId": "<UUID>" }` | Creates definition, variant picks, draft revision 0 and creation receipt in the existing per-learner creation transaction. A retry returns the original attempt even after grading. |
| `GET :attemptId/snapshot` | None | Pinned learner definition, acknowledged draft, immutable submission if present, and readable result if committed. |
| `PUT :attemptId/draft` | `{ "operationId": "<UUID>", "expectedRevision": 0, "answers": [...] }` | Replaces the entire draft with revision 1 and stores a durable save receipt. |
| `POST :attemptId/submissions` | `{ "operationId": "<UUID>", "expectedRevision": 1 }` | Freezes exactly revision 1, then grades that snapshot. Retrying the same command resumes the same submission. |
| `POST :attemptId/sources` | `{ "uploadId": "<completed upload ID>" }` | Binds an owned completed upload to this attempt; other attempts cannot reuse it. |

Every new logical command needs a fresh UUID. Retrying a save uses the identical UUID, revision and answer body. Reusing an operation UUID with different content returns 409. A late save receipt can acknowledge an older revision: the client must never move its displayed revision backwards. A stale revision returns `DRAFT_CONFLICT` with the current revision; reload and reconcile in the client (Part 07), never silently overwrite.

Draft answers use `questionId` and `choiceIds`. Compatibility clients may instead provide `choiceLabels`; these map **exactly and unambiguously** against the pinned labels during draft ingestion. No quote stripping, numeric rewriting, translation lookup or text scoring occurs in the new choice grader. Repeated/foreign choice IDs and multiple answers for one question are rejected. Generic answer contracts also preserve text, false, zero and source IDs for subsequent source cohorts.

Save, source binding and submit serialize on the attempt row. Save/submit races either freeze the requested revision or return a conflict. Once a submission exists, drafts cannot change through the API. A completed upload is bound under its own row lock and a global unique upload ID, preventing two concurrent attempts from claiming it. Snapshot source records retain the storage references; they do not yet provide content-addressed retention or repository capture (Parts 04/14).

One submission is allowed per attempt. Retaking means creating a **new attempt** with a new creation operation ID, subject to existing attempt/cooldown rules. Resubmission does not mutate historical evidence. No administrative regrade/correction path is enabled for this cohort until its immutable-result semantics are implemented in Parts 06/15.

## Definition and grading boundary

Creation snapshots the selected published assignment configuration, exact question/version IDs, chosen variant configuration/rubric, question order and shuffled choice order. Each choice gets an opaque per-definition UUID. Mutable variant pools are excluded. No live translation is applied: the captured published language remains the learner/grading language for the lifetime of this cohort. Later publication, rubric edits, translation changes and display labels cannot change its meaning.

The learner projection excludes correctness, per-choice scoring, hidden rubric/configuration and author-only fields. Result visibility uses the captured settings. Detailed feedback is exposed on reload only when submission feedback and `ALWAYS` correct-answer visibility permit it; other visibility modes remain conservative. The current browser is not automatically switched to these endpoints; Part 07 owns its reconciliation and presentation integration.

Grading loads the immutable submission and definition, ignoring caller-supplied answers and mutable draft/current publication. Choice grading does not enter legacy text-recovery strategies. Atomic result commit stores `AssignmentAttempt.resultSubmissionId`; a composite foreign key prevents linking a grade to another attempt's submission. Transaction-local submission identity authorizes response/result writes, so the legacy writers cannot bypass the invariant. Failed commits leave no responses/grade. A retry reads the winner of a concurrent commit and does not overwrite it. LMS delivery remains after commit through the existing delivery service.

The submission commit and grading dispatch are **not a durable outbox**. A process failure after accepting the snapshot requires a client retry to resume grading; automatic recovery, durable dispatch, result revisions and delivery reconciliation remain Part 06. The acceptance snapshot is still durable and unambiguous throughout that gap.

## Migration, retention and rollback

Apply `20261022153000_attempt_snapshots` before deploying the new API/workers. It adds tables, an optional result link, constraints and triggers without backfilling or modifying legacy answer content. It is transactional, with a 5-second lock timeout and 30-second statement timeout; a busy database must retry the migration in a suitable deployment window. Local synthetic migration timing is not a production lock-time estimate.

Existing attempts have no definition and remain explicitly legacy. No current publication is used to guess an old rubric, variant or answer identity. Reconstruction/backfill is intentionally disabled; any future historical importer must supply independently verifiable provenance and separate review. Missing/deleted historical question fixtures remain readable by the legacy adapter.

Definitions, creation/save receipts, source bindings and submissions cannot be updated or deleted through ordinary SQL mutations. References are retained even when mutable author content changes. Retention/erasure requires a separately reviewed maintenance operation; automatic storage cleanup must not delete referenced source objects (Part 14). There is no destructive down migration.

Enable a pilot only after API/worker migrations and the revised client are deployed and compatible:

```
ATTEMPT_SNAPSHOT_ASSIGNMENT_IDS=123,456
```

The default is empty. Eligibility is checked at creation; unsupported question types reject the whole creation transaction. Disabling the allowlist stops new creation, while existing snapshot reads/saves/submissions and exact creation retries continue. Do not roll active pinned attempts onto an older binary: drain them or retain routing to a snapshot-aware API. Retire legacy paths only after cohort evidence and observation, not because these tests pass.

## Validation

`yarn workspace api test:attempt-snapshots:integration` starts a disposable localhost PostgreSQL 16 container, builds the pre-change schema from the frozen test fixture, inserts legacy active/completed attempts, applies the real migration, and runs integration tests. It stops only its own container. It does not load development database settings or call an LLM, COS, Redis or an LMS. Docker and the installed workspace dependencies are required. Ordinary Jest runs skip this database suite unless explicitly configured.

Coverage includes concurrent saves, save/submit races, lost-response retries, replay after grading, mutation/rollback guards, foreign assignment/owner/source IDs, pending uploads, deadlines, variant/version/rubric capture, legacy migration reads, false/zero, and a complete creation-to-readable-grade journey with publication changes and a failed first commit. Shared contract tests cover quoted/numeric/ambiguous labels, shuffled/translated labels, duplicate IDs and long answers past 200 characters. Real-LLM assignment benchmarks remain a separate, manual command.
