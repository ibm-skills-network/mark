# Part 01 implementation and release notes

This note records the containment changes on `STRANGLER_FIG/part-1`. It implements the immediate-containment work package from the local Strangler Fig plan; it is not evidence of a production deployment or completion of the durable-workflow redesign.

## Implemented behavior

- File grading checks every submitted extraction result before creating model inputs, scoring, judging, or recording a successful grading audit. All submitted files are required because the existing API has no explicit optional-artifact contract. One failed file blocks a mixed upload.
- Explicit extractor errors, failed parser fallbacks, corrupt PDF/ZIP/spreadsheet/notebook placeholders, unsupported archive extraction, and unreadable archive members cannot become evidence. Preview extraction can still return diagnostic content, but grading rejects it. An empty structured document is insufficient evidence; valid vision input does not require text. An explicitly empty text file and an unanswered question retain their separate blank-answer policy.
- COS outages remain retryable through the existing job attempt limit. Missing/inaccessible objects and unusable extraction are processing failures with an actionable learner message. Source references in new containment logs are positional IDs, not signed URLs or file contents.
- Failed/empty URL fetches no longer award zero or fallback credit. Existing typed transient URL errors still use their established retry policy. Provider failure no longer awards half credit.
- Repository-root fetching identifies README, repository metadata, and page-scrape evidence. `REPO` questions block on those outcomes because they do not establish implementation evidence. There is no heuristic exemption based on a few words in the rubric. A future explicit README-sufficient policy belongs with parts 02/05; direct source-file URLs and non-REPO URL behavior remain distinct.
- The branch already preserved URL text without an extra JSON encoding and constructed typed moderation inputs. Regression tests retain those fixes. File/text/URL grading now requires a successful moderation check; transport/provider failure is retryable rather than silently allowing content. Severe and ordinary moderation verdicts retain their existing policies, and authoring validation retains its existing failure policy.
- Exceptions propagate before the existing atomic submission commit. Previously saved responses are not pruned after failed re-evaluation. No new authoritative grade, completion acknowledgement, or LTI send is produced for a blocked submission.

## Failure mapping

| Outcome | Code / identity | HTTP | Worker behavior |
| --- | --- | --- | --- |
| Required extraction failure | `SourceProcessingError`, `extraction_failed` | 422 | Terminal; show safe processing message |
| Unproven required evidence | `SourceProcessingError`, `insufficient_source_evidence` | 422 | Terminal; replace source or request instructor review |
| Required URL unavailable | `SourceProcessingError`, `url_fetch_failed` | 422 | Terminal for confirmed failure; transient and unexpected exceptions retain bounded retries |
| Temporary COS failure | `RetryableProcessingError`, `source_unavailable` | 503 | Existing bounded retries |
| Moderation/provider outage | `RetryableProcessingError`, `moderation_unavailable` / `grading_unavailable` | 503 | Existing bounded retries |

Structured HTTP outcomes include reason and retryability, plus the affected source reference for terminal source errors. Existing job failure handling updates GradingProgress and the SSE status channel; no new workflow/status schema is introduced. The remote executor explicitly preserves terminal source-error identity so it does not become an indefinitely retried generic HTTP failure. Queue retries remain bounded by existing queue configuration, including when an error crosses the remote executor.

## Verification evidence

Tests cover the actual file extraction service with malformed PDF, ZIP, XLSX, and notebook bytes; mixed required files; missing extraction results; visual and blank-text distinctions; retryable object-storage failure; URL fetch failures and serialization; repository evidence classification; and actual moderation request construction with the provider client stubbed.

Submission tests verify that extraction failure prevents commit, completion, and LTI delivery. Re-evaluation tests verify previous responses are not pruned. HTTP tests verify safe typed outcomes. Worker tests verify both local classification and the remote executor boundary. Existing extraction, file/text/URL grading, question-response, and LTI suites supply compatibility coverage.

These are local tests with controlled storage/provider/database dependencies. They do not establish native-parser behavior in built production images, real LMS delivery, or live-model correctness. Those broader pipeline checks belong to part 09 and cohort release gates.

## Local check results

- API regression selection: **30 suites, 563 tests passed** (extraction, file/text/URL grading, moderation, GitHub fetches, question responses, submission, HTTP failure mapping, and LTI compatibility).
- Jobs worker suite: **83 tests passed**, including local and remote processing failure classification.
- API and jobs TypeScript checks: passed (`tsc --noEmit -p tsconfig.json` in each workspace).
- Changed production files: ESLint passed with no errors. The API reports two pre-existing unused `_extractedAt` warnings in file grading.
- `git diff --check`: passed.

Reproduce the API selection from the repository root:

```sh
./node_modules/.bin/jest --config apps/api/jest.config.ts --runInBand --silent --testPathPattern='(file-grading|file-content-extraction|url-grading|github-content-fetch|text-grading|grading-boundaries|attempt-submission|all-exceptions.filter|lti-grade-sync|question-response.service|moderation.service).*spec.ts$'
```

Run `./node_modules/.bin/jest --runInBand --runTestsByPath src/job-worker.service.spec.ts` from `apps/jobs` for worker coverage. These commands invoke Jest directly and do not change Turborepo configuration.

## Correctness baseline and remaining ownership

| Invariant | Existing boundary / containment evidence | Remaining gap and reproducer | Owner |
| --- | --- | --- | --- |
| Accepted work survives worker/Redis loss | Typed failures stop false success; existing retries retained | Interrupt enqueue after acceptance or erase queued work: no new transactional outbox/reconstruction guarantee is added here | Part 06, with part 08 recovery tests |
| Required extraction failure cannot become a low grade | File strategy gate; URL failure gate; malformed-input and mixed-upload regressions | Canonical server extraction and complete criterion-specific sufficiency are not yet enforced: client text can still be trusted, and valid but shortened evidence may omit decisive material | Parts 04–05, exercised by part 09 |
| A completed grade is durably readable | Existing grade-before-commit and commit-before-completion ordering; submission regressions | Kill workers/DB around commit and status notification to establish full recovery; instrumentation and reconciliation need dedicated fault injection | Parts 06/08/09 |
| Exported grade belongs to committed revision | Existing commit-before-LTI ordering; no-send-on-processing-error tests | Crash after commit before delivery scheduling, or race two revisions: no transactional delivery intent or new revision fencing is introduced | Part 06 |
| Retrying cannot create another authoritative result | Existing duplicate-submit/conflict handling retained; terminal source errors are not retried | Race late workers and regrades after queue redelivery: comprehensive run/version fencing is still required | Parts 03/06 |

Advanced omissions, content budgets, compiled-artifact sufficiency, repository implementation retrieval, and cache identity remain part 05 work. The checks here target explicit known extraction failures and clearly insufficient outcomes; they do not prove that every nonempty document is sufficient for every rubric.

## Deployment and verification

1. Deploy API and worker changes together so the worker understands the new terminal processing identity. No database migration is required. Existing workers may retry a new error until their configured retry budget expires; API safeguards still prevent its grade from committing.
2. Replay the containment fixtures, then verify a good file/URL submission and a mixed good/corrupt upload through the deployed status/polling path. Confirm the latter creates no new committed grade or delivery and leaves any prior committed grade readable.
3. Count `grading.source_processing.blocked` events by reason, assignment, and question, distinguishing retryable storage failures from terminal source failures. Deduplicate retries by attempt/question/source when estimating affected submissions. Compare against grade commits and LTI sends; the same failed run must produce neither. Review `grading.provider.blocked` and moderation failure logs separately.
4. Establish the production baseline during the release observation window. No production count or rate was measured during this implementation. Pay particular attention to `REPO` questions and unsupported archives, which previously could receive grades from insufficient material.
5. If unexpected blocks appear, retain the missing-evidence safeguard and investigate the format/classification. Roll back unrelated changes or pause affected grading as needed; do not restore fabricated grades as a recovery mechanism. Broader rollout/rollback ownership is in part 10.
