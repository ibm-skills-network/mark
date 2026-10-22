# Backend contracts — learner grading runtime boundary

The `backend-contracts` workspace owns runtime schemas shared by the API and jobs app. Zod is already used in this repository. Exported types are inferred from those schemas; the package compiles with strict null checking, exact optional properties and unchecked-index checking. It depends only on Zod; its architecture test rejects application/framework/provider imports.

## Adopted boundary

The v2 learner attempt PATCH validates the legacy submission before starting either inline deterministic grading or queued grading. The producer validates and emits a `schemaVersion: 1` grading payload. Normal and heavy workers validate before local execution or forwarding; the API executor validates again before calling the grading service. HTTP failures return 400 with `INVALID_GRADING_CONTRACT`, boundary and a safe message. Worker failures are unrecoverable, so malformed messages do not consume repeated LLM calls.

This first slice covers learner submission transport and the `attempt.grade` job. Author previews, v1 HTTP entry, generation/translation jobs, provider outputs, storage manifests and canonical artifacts remain outside this migration. Existing access guards and domain checks still enforce assignment ownership, attempt eligibility, version/question membership and file access. A valid schema is not authorization.

`gradingJobId` identifies the existing grading run. This message is **not** an immutable submission record, a durable dispatch intent, or proof of idempotency. The existing queue/job status mechanism remains in use. Parts 03/06 must establish revision identities, durable acceptance, fencing and reconciliation before those guarantees can be claimed. No fake revision or checksum is synthesized from mutable state.

## Schema policy

- Version 1 has a strict top-level envelope: schemaVersion, gradingJobId, attemptId, assignmentId, updateDto, userSession, optional authCookie.
- IDs are positive safe integers; grading job IDs are nonempty strings up to 256 characters. No string-to-number or boolean coercion occurs.
- Submission requires `submitted: true`, an array of responses, and unique positive question IDs. Empty responses remain possible for existing unanswered/expiry behavior; downstream domain policy decides their meaning.
- `false`, numeric zero, quoted choices, Unicode, empty strings and empty arrays retain their meaning. Numeric choice values remain supported for legacy compatibility.
- Optional legacy answer fields accept null/absence. Typed text/choice/file/presentation containers are checked. The learner URL limit matches the existing 2048-character DTO limit; URL normalization/access policy remains downstream.
- Legacy submission/answer/file metadata is retained with passthrough schemas. Notebook content may be JSON text or a legacy parsed JSON object/array, preserving #768 normalization compatibility. Such content, image analysis, storage keys and extracted text are untrusted. This is deliberately not the reference-only canonical artifact interface planned for Parts 04/14.
- Existing HTTP/queue/parser limits remain in force; this slice does not introduce a new comprehensive payload/resource budget. File contents are never truncated by the adapter.
- Errors expose stable code, boundary and retryability, not Zod inputs, answer text or callback credentials. This slice reports the failing boundary, not raw field values.

## Compatibility and rollout

| Producer / message | New consumer | Old consumer |
| --- | --- | --- |
| Existing producer, no schemaVersion | Explicit legacy adapter validates then maps to v1 | Existing behavior |
| New producer, version 1 | Strict envelope validation | Same existing fields plus version tag; old implementation ignores the tag |
| Explicit unsupported/malformed version | Terminal rejection; never interpreted as legacy | Old consumers do not enforce versions; do not send future versions until all consumers support them |

Deploy API executor and normal/heavy worker consumers before relying on validation for all traffic, then enable the producer release. This release emits the same legacy field meanings, so the additive v1 tag remains compatible with old consumers during rollout/rollback. Future incompatible versions require a new adapter and consumer-first rollout. The two workers share a queue schema and terminal error policy.

A malformed job is retained according to the existing bounded BullMQ failed-job policy, with `attempt.grade.contract.rejected` diagnostics (queue job ID, code, boundary). Its queue-owned job ID may update Redis terminal job status. **Payload-supplied attempt/grading IDs are not used to mark domain progress failed after contract rejection.** Operations should inspect the producer/version, correct it and create a valid submission; do not repeatedly replay a malformed message. Long-term quarantine retention and repair tooling remain Parts 06/15/16.

Current source work is based on `c9bbe791`; #768 (`1db50684`) is not in that branch ancestry. Reconcile with the release branch before deployment and preserve #768's notebook normalization, upload telemetry and grading fixes. No production rollout or post-deployment correctness is claimed by the local tests.

## Build and validation

The API/jobs declare the workspace dependency. Their build, start and standard test commands build its generated output first; Turbo's existing `^build` also orders it for aggregate builds. Production Docker stages copy the package to the workspace symlink target. If invoking Jest or TypeScript directly, build the package first:

```sh
yarn workspace backend-contracts build
yarn workspace backend-contracts test
```

Package tests cover JSON round trips, false/zero/quoted choices, Unicode and notebook objects, full long-source retention, duplicate IDs, malformed types, version rejection, safe errors and dependency direction. API tests cover HTTP routing and executor rejection before grading; worker tests cover local/remote rejection, no retry, and no attempt-state mutation from rejected payloads. These checks make no real LLM calls.

This is Part 02's initial implementation slice. Artifact/evidence/result schemas, immutable revision contracts, provider outcome validation, broader boundary adapters and real workflow release evidence remain required before the whole package is done.


## Result and commit boundary

The learner grading adapter also validates the score returned by each strategy: finite, nonnegative points, within the server-loaded question maximum, with no conflicting question identity. Legacy strategies may omit the question ID; the orchestrator binds the known question in that case. This checks normalized strategy output, not every provider's raw JSON or semantic grading quality. Author previews remain outside this migration.

Before the atomic learner commit, `gradeCommitV1Schema` requires a finite grade in [0,1], unique expected/result question identities and a complete matching result set. The writer uses an explicit field list (submitted, preferredLanguage, expiresAt, grade); arbitrary request fields cannot become attempt updates. Inside the transaction, read-back must match the exact attempt and grade. A rejection propagates before completion/LMS delivery; actual PostgreSQL rollback/recovery testing remains a separate release gate.

`InvalidGradingResultError` maps to a safe 502 outcome with `INVALID_GRADING_RESULT` and `retryable: false`. Local and forwarded workers preserve this as terminal, update the valid operation's failure status and save no new grade. It is distinct from malformed-job quarantine: rejected payload IDs still cannot authorize domain state updates. A learner can retry or request support; semantic insufficiency/review and provider retry policies require the later evidence/grading slice.

CI service filters include shared packages and API source imported by jobs. Shared contract tests run with API tests, and the package builds before typed lint. Both production Dockerfiles require the compiled package during the image build. A local network-disabled Linux Node 24 smoke check verified workspace symlink resolution and execution of a compiled validator; this is not a full API/jobs container startup or production deployment test.
