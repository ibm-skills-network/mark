# Canonical artifacts

Part 04 introduces versioned extraction evidence; it does not assert that readable text satisfies a grading rubric. See [FORMAT_MATRIX.md](FORMAT_MATRIX.md) for format variants and explicit omissions. The server assigns source-qualified block IDs and validates the manifest before retaining it. Browser-supplied extracted text is never an authoritative parser input.

## Isolated parser runtime

`parser/isolated-artifact-parser.ts` launches a fresh Node process for each source. The compiled worker and lazy adapter modules are emitted by both API and jobs builds; jobs explicitly includes the parser directory because the worker entrypoint is resolved by filename rather than an application import.

Default per-process limits are 20 MiB input, 8 MiB expanded evidence, 12 MiB serialized output, 200 PDF pages, 30 seconds, a 256 MiB V8 heap and a 512 MiB RSS budget. Adapters additionally bound archive expansion, entry count/depth, and image dimensions. Callers may lower limits, never raise these defaults. Parent-side RSS sampling runs every 100 milliseconds (`/proc` on Linux); it can transiently overshoot between samples and is not a kernel memory reservation. Production container memory limits and admission controls remain necessary for concurrent requests.

Cancellation, timeout, excessive output or excessive RSS kill the worker and settle only after its streams close. No parser temporary files are created. Input and output travel through bounded pipes. Child diagnostics do not include source bytes. The child receives a minimal environment with no inherited application credentials. Node permissions deny filesystem writes and subprocesses; reads are restricted to parser/dependency directories. Native addons are permitted for Sharp/PDF native dependencies.

This is process and resource isolation of trusted parsers, **not an operating-system sandbox for hostile executable code**. Node 24 permissions do not block network access. The worker explicitly disables public Node network entrypoints and fetch before loading adapters. Adapters consume bytes, never URLs, and do not execute submitted scripts. The URL fetch service applies the existing SSRF policy before handing stored bytes to the worker. Native-code compromise is outside this boundary; stronger OS network isolation is a deployment hardening follow-up.

PDF extraction preserves all text pages with stable page locations. Images, vector graphics, annotations, embedded attachments and scripts become structured omissions, so a text-bearing PDF cannot silently claim complete visual evidence. URL HTML is parsed as inert markup; images/media, scripts/dynamic behavior and CSS-generated/layout content are explicit omissions. Invalid UTF-8 is rejected instead of silently replacing bytes.

## Verification

Run the ordinary parser tests without provider credentials:

```sh
cd apps/api
node ../../node_modules/jest/bin/jest.js --runInBand src/api/attempt/artifacts/parser
```

The runtime suite launches real child processes and the installed PDF parser. It verifies content beyond the first 200 characters, final-page evidence, vector omissions, malformed PDF isolation, page/input/output/RSS limits, timeout, cancellation, inert HTML, filesystem/network API/subprocess denial, and empty input. These are deterministic checks; they never invoke a paid LLM benchmark.

For production packaging verification, build each existing Dockerfile and mount `parser/image-smoke.cjs` read-only. Pass the image's compiled parser directory:

```sh
docker build -f apps/api/Dockerfile -t mark-api:part4-local .
docker build -f apps/jobs/Dockerfile -t mark-jobs:part4-local .
docker run --rm --network none --entrypoint node \
  -v "$PWD/apps/api/src/api/attempt/artifacts/parser/image-smoke.cjs:/tmp/image-smoke.cjs:ro" \
  mark-api:part4-local /tmp/image-smoke.cjs /usr/src/app/dist/api/attempt/artifacts/parser
docker run --rm --network none --entrypoint node \
  -v "$PWD/apps/api/src/api/attempt/artifacts/parser/image-smoke.cjs:/tmp/image-smoke.cjs:ro" \
  mark-jobs:part4-local /tmp/image-smoke.cjs /usr/src/app/dist/api/src/api/attempt/artifacts/parser
```

The image smoke covers actual compiled worker resolution, late PDF evidence, native PNG handling, notebook plots, archive sources, sparse XLSX, DOCX, PPTX, inert URLs, malformed input, expansion/deadline/cancellation and four concurrent parsers. This checks parser packaging, not application startup, storage availability, grading quality or deployment readiness.

### Recorded evidence

2026-10-22 deterministic verification: 24 shared contract tests, 136 API artifact/storage/queue/access tests (including the 35 parser tests), 120 grading regressions, 126 jobs tests, 29 real PostgreSQL tests, and 35 file-controller/S3 compatibility tests passed: 470 total. The two pre-existing jobs end-to-end cases still skip because their seed fixture is unimplemented. The new database suites run separately through the disposable-database runner. API build, API/jobs typechecks, targeted lint and staged secret checks passed. The final real Redis transport smoke also passed; no LLM calls were made.

- Local Node 24: all 35 parser tests passed (12 runtime tests, including real child processes); all-format native smoke passed against the compiled jobs output.
- 2026-10-22: both production Dockerfiles built successfully on Linux ARM64 / Node 24.15.0. Both compiled-worker presence checks and the all-format native smoke passed with `--network none`, including four concurrent parsers.
- API image `mark-api:part4-local`: `sha256:0ba23ccf92b42c6793ecdb7bec5f4a83cafc744d88f5fdc3c44dc69d63038608`. This final refresh includes dependency-outage isolation and the extraction queue retry policy.
- Jobs image `mark-jobs:part4-local`: `sha256:65ed3192aac76f219ad7424902e9081965804bce7a4fb3175053424d5350c54e`. It verifies the final parser runtime, native dependencies and compiled worker layout. The subsequent producer retry-policy adjustment was validated in the final API image and queue tests.

Build contexts contained tracked files and the new implementation files, excluding local credentials and ignored caches. Transient Yarn CDN 502/503 responses required the final API build to use the official npm registry mirror in its temporary build context; dependency versions and integrity hashes were unchanged, and the repository lockfile was not edited. Both images used the repository production Dockerfiles and `node:24-slim` base. Linux AMD64 parity and deployed database/Redis/COS/worker recovery remain release gates; these local image tests do not establish production readiness.

## Stored sources, extraction and submission

Apply `20261022153000_attempt_snapshots` then `20261022170000_canonical_artifacts` before starting this code. Both migrations are additive; original records, manifests and derived resources have database mutation guards. There is no legacy backfill. Extraction operations are mutable coordination records with a version/config identity, expiring lease and fencing token; an expired worker cannot replace a newer result. Historical failure manifests remain available after a successful retry.

`ArtifactStorageService` retrieves the original with a 15-second deadline and an actual streamed 20 MiB ceiling, then hashes all bytes. The first extraction pins checksum, length, media type and storage identity. A changed object fails integrity checks. Authorization comes from the attempt owner and source binding, never the checksum. API resource reads check ownership again; downloads use attachment disposition, no-sniff and private/no-store headers. Embedded notebook PNG/JPEG/WebP resources are decoded in the isolated parser, retained with immutable checksums and served through authorized routes.

The heavy queue carries an encrypted UUID operation reference, not source bytes or user-provided parser output. Artifact jobs always execute locally in the jobs process, even when grading uses API forwarding. Each process admits at most two concurrent extractions; each parser has the bounds above. Artifact jobs default to five attempts with exponential backoff starting at 15 seconds, allowing parser admission and 120-second leases to recover instead of exhausting immediate retries. Queue retries and an explicit extraction request can recover transient storage/dependency failure. This is not the Part 06 transactional outbox or automatic abandoned-operation sweeper: a failed enqueue leaves a visible pending record and an explicit retry re-enqueues it. Failed terminal inputs require a corrected source.

Deletion, folder deletion, move and rename reserve object mutations under the same PostgreSQL lock used by source binding. Retained originals cannot be deleted or overwritten through those endpoints. A deletion tombstone is committed before storage mutation; uncertain storage failures leave it in place, so a subsequent source binding cannot race an in-flight delete. Re-upload under a fresh key to recover. This protects application mutations, not privileged COS administration or still-valid legacy presigned writes; checksum checks detect changed originals. Part 14 owns bucket versioning/retention policy, direct-upload convergence and orphan reconciliation.

URL capture accepts public HTML/plain text only, uses the existing connection-time SSRF checks, and bounds redirects, actual response bytes (4 MiB), total fetch/storage time, per-attempt source count and Redis-backed request rate. It retains original/resolved URLs and stores response bytes once; extraction never refetches the remote page. Unsupported remote formats require uploading the original file. A process crash between COS write and the database transaction can leave an orphan `canonical-url/` object; reconcile unreferenced keys through Part 14. Cleanup must never delete referenced originals.

## Opt-in API and rollout

All routes below are authenticated v2 routes; attempt routes require the existing assignment/attempt access guard plus service-level ownership checks.

- `GET artifacts/capabilities?assignmentId=42`: shared format inventory and effective preview policy. Unsupported variants remain explicit; no extension implies gradeability.
- `POST assignments/:assignmentId/attempts/snapshot`: existing immutable attempt creation. `ATTEMPT_SNAPSHOT_ASSIGNMENT_IDS` remains choice-only. `ARTIFACT_PREVIEW_ASSIGNMENT_IDS` additionally permits non-choice definitions **for development/staging preprocessing only**; both default to empty.
- `POST .../attempts/:attemptId/sources` with `{uploadId}`: bind a completed owned multipart upload. Direct uploads and presigned PUTs do not yet have the completed-upload receipt required by this path.
- `POST .../attempts/:attemptId/sources/url` with `{url}`: capture a bounded public URL into a new owned source.
- `POST .../attempts/:attemptId/sources/:sourceId/artifacts`: request or retry extraction.
- `GET .../attempts/:attemptId/sources/:sourceId/artifacts`: pending/complete/failed operation state and validated manifest (`success`, `empty`, `partial`, `unsupported`, `failed`). `gradeable` remains false.
- `GET .../artifacts/:artifactId/resources/:resourceId`: authorized derived resource download; `original` downloads the original after checksum verification.

The draft revision check fences edits made during source validation. Submission pins validated artifact IDs/checksums, and partial/empty/failed sources block freezing. Non-choice snapshot grading explicitly blocks until Part 05 supplies its evidence gate, rather than falling through legacy extraction. An extraction success is only a preprocessing result. Do not enable the preview cohort for ordinary learners who need a final grade.

Existing browser upload controls remain on the legacy lane. Part 07 must consume the capability endpoint and reconcile asynchronous status before the canonical cohort is released; changing the preview allowlist alone does not migrate the browser. Existing legacy formats are not silently removed. Repository URLs are not immutable repository snapshots and remain unsupported here; repository acquisition/sufficiency belongs to its explicitly reviewed slice.

## Persistence and recovery verification

Run `yarn workspace api test:attempt-snapshots:integration` on demand. It creates its own PostgreSQL 16 container, loads legacy fixtures, applies both actual migrations, and checks immutable records, ownership, retries, lease fencing, source-retention races and Part 03 compatibility. It stops only that temporary container. These database tests substitute the parser boundary; real native-parser/process tests and image smoke cover that boundary separately. Storage-stream tests exercise truncation, dishonest content length and stalled reads. URL tests use synthetic streams and verify redirect/size/state guards. None of these checks invokes an LLM.

Run `yarn workspace api test:artifacts:queue` on demand for the transport smoke. It builds the API, starts its own disposable Redis 7 container on a loopback-only ephemeral port, and checks the actual compiled queue producer, AES-GCM payloads, BullMQ delivery, strict operation identities and isolated parser. A corrupt PDF fails once, a subsequent healthy source retains its late content, and an injected transient dependency outage retries successfully. Successful parser output passes the canonical manifest contract. The harness uses in-memory original fixtures: it does not claim COS/database/HTTP authorization or complete `JobWorkerService` startup coverage. It performs no LLM calls and removes its Redis container on completion or failure. Use `node apps/api/test/run-artifact-queue.cjs --skip-build` only after a current API build; do not run overlapping builds against the same `dist` directory.

A deployed end-to-end run through the actual database, Redis, COS and heavy worker, with restart recovery and mixed valid/corrupt files, remains a release gate. Production architecture parity, container memory limits, original retention policy and valid-work completion must be checked there. The paid grading benchmark is still manual; its next meaningful grading-quality comparison is after Part 05 integrates canonical evidence into grading.

Cache identity includes `ARTIFACT_EXTRACTOR_VERSION`, parser limits, installed parser dependency versions and the Node/platform/architecture identity. Bump the extractor version when changing adapter behavior or parser dependency versions; an unchanged version is not permission to reinterpret a historical manifest. Source-qualified block IDs are deterministic within a given extraction, and stored locations identify the evidence within the original.
