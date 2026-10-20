# Local assignment benchmarks

These are **manual, real-LLM benchmarks**, not unit tests. Nothing invokes them from CI, Jest, Playwright, Turbo, hooks, development startup, or migrations. The default suite creates five published assignments and fifteen synthetic learner attempts, uploads real files, submits through the learner API, and checks the saved and learner-visible results. It also submits three deliberately broken policy attempts. Expect provider charges and retained local records/files.

The assignment `type` is `AI_GRADED` for all five because that is Mark's existing assignment enum. The **deterministic** assignment contains only single-choice, multiple-choice, and true/false questions; grading it must make zero model calls. Publication is a separate workflow and may use models.

## Run on demand

Use Node 24+ and the repository's installed dependencies. Start your normal local API, database, Redis/workers, and configured development object storage first. The API needs working OpenAI credentials. Use the same local database in the benchmark and API. The CLI reads `apps/api/dev.env`, then root `dev.env`, without overriding explicitly exported environment variables. It does not load production credentials or invoke Kubernetes.

```sh
# No services or provider calls: validate generated fixture structure.
yarn benchmark:assignments validate

# Explicit local database change, if old feature assignments override Luna.
yarn benchmark:assignments set-model
# Restart API AND grading workers after changing model assignments.

# Answer-key smoke run, followed by the complete real-LLM run.
yarn benchmark:assignments run --assignment deterministic
yarn benchmark:assignments run

# Narrow a grading investigation or measure model variability.
yarn benchmark:assignments run --assignment software --tier great
yarn benchmark:assignments run --repeats 3

# Same fixtures, selected cases, and repeat count on both sides.
yarn benchmark:assignments compare benchmarks/assignments/runs/BEFORE/report.json benchmarks/assignments/runs/AFTER/report.json

# Inspect synthetic files and answers without seeding or spending tokens.
yarn benchmark:assignments export /tmp/mark-assignment-fixtures

# Explicit offline harness/extractor verification; no model calls.
node --test benchmarks/assignments/verify.cjs
```

`run` supports `--api`, `--output`, `--timeout` (seconds per publication/attempt, default 900), `--assignment`, `--tier`, and `--repeats` (1–10). Each run/repeat creates fresh assignments and question IDs, isolating grade caches without globally deleting caches or changing production grading behavior. Learner IDs are unique `@local.invalid` identities supplied through Mark's existing local `user-session` mechanism; these are not email accounts. Model prompts receive neutral filenames, never the poor/mediocre/great labels.

The existing backend default is already **`gpt-6-luna`**. Before creating assignments, the CLI resolves local database feature assignments/defaults and rejects non-Luna selections. `set-model` updates local model assignments and defaults; it does not change historical migrations. Reports include requested model, feature configuration, and actual model/token usage reported by Mark. The usage table aggregates by assignment and operation type, so these are sequential per-attempt deltas, **not provider-level traces of every individual call**. Run against a dedicated local instance with no other activity on these assignments. A normal AI attempt without recorded grading calls fails rather than claiming cached results simulate production.

Only loopback API/database targets are accepted. The API can still be configured with remote storage: use development buckets, not production buckets. LMS delivery and notification emails are not requested. The benchmark calls the API directly, as local API tests do; it does not exercise gateway/LTI/browser authentication.

## Fixture coverage

| Assignment              | Three question modalities                                                      | Evidence and edge cases                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Answer-key fundamentals | Single correct, multiple correct, true/false                                   | Numeric choice text, randomized choices, multiple correct answers, explicit `false`, exact scores, duplicate-submit stability                                                                                      |
| Checkout reconciliation | Python upload, nested ZIP implementation, written explanation                  | All variants have identical first 200 characters; implementation/tests occur after 1,000 characters; duplicate IDs, negative values, empty input, boolean versus integer validation; implementation outside README |
| Ledger analysis         | XLSX workbook, executed notebook, written interpretation                       | Multiple sheets, sparse rows, a decisive correction at row 217, duplicate IDs, missing values, notebook code/output/final markdown                                                                                 |
| Retention review        | Three-page PDF, DOCX through LINK_FILE's upload branch, written recommendation | Draft contradicts final signed appendix; decisive final-page/late-paragraph evidence; legal-hold exception; operational controls and verification                                                                  |
| Release readiness       | Three-slide PPTX, PNG dashboard, written handover                              | Decisive final slide, visual-only dashboard text, quantitative thresholds, observation windows, ownership and recovery                                                                                             |

The normal suite has **45 question responses**, with three independently scored rubric criteria per AI question. Each criterion has explicit zero/partial/full levels. The deterministic question scores are exact: poor 0/36, mediocre 24/36, great 36/36. AI reference bands are poor 0–35%, mediocre 20–80%, great 80–100%, plus strict assignment-level poor < mediocre < great ordering when all three tiers are selected.

These are authored reference expectations, **not yet expert-calibrated ground truth**. Review the first real run's individual criterion evidence and feedback, not just aggregate scores. Do not widen bands simply to make regressions pass. Use repeats to measure variability; model responses are not assumed deterministic. A changed rubric/fixture produces a different suite hash and requires a new reviewed baseline.

The policy assignment additionally exercises corrupt PDF, missing stored object, and mixed valid/corrupt files. Each must produce an explicit failed state or a controlled validation error, with no committed grade or partial question grades. HTTP 500s, timeouts, or a fabricated zero score fail the benchmark. A timeout stops the run to avoid adding more work behind an unhealthy queue; it **does not cancel** already accepted server work. Inspect the saved attempt before rerunning.

## Evidence and comparison

Each run writes a readable `summary.md` and detailed `report.json`. Each report includes fixture/asset hashes, Git revision and dirty flag, selection, model configuration, published assignment/version/question IDs, synthetic user and attempt IDs, per-question scores/feedback/metadata, grading audits, learner-visible completed response, final persisted state, actual token/call deltas, errors, and wall-clock duration. Reports are checkpointed after assignment creation and each attempt, including failures, so inspect incomplete runs instead of losing their IDs. `run` exits nonzero on failed assertions or incomplete work.

`compare` prints grade and latency deltas, question score changes, and before/after failures. It refuses incomplete reports, different fixture hashes, different selected cases/repeats, and different requested models. It does not auto-approve a new baseline or treat increased scores as necessarily better. Keep a reviewed report before backend/grading changes and compare a matching fresh run afterwards. Inspect criterion feedback in the JSON for unexpected changes even when total scores stay equal.

Runs and exports under `runs/` are gitignored. Keep report directories outside git if supplying `--output`. Reports contain synthetic learner content and internal storage identifiers/audits; don't publish them blindly. The CLI retains its labeled local assignments, attempts and files for inspection. It does not bulk-delete anything. Use your normal local disposable-environment reset when finished, or remove only the IDs/objects belonging to that run through existing administration tools.

## Extending the corpus

For each support regression, add a minimal reproducer plus a contrasting correct submission and a specific assertion. Preserve full source bytes and checksums; assert the evidence that used to be lost, not just that the endpoint returned 200. The offline verifier checks the real Mark extractors retain late evidence in Python, ZIP, XLSX, notebooks, DOCX, PPTX and PDF, and proves identical-prefix truncation cannot satisfy both poor/great score bands. Offline verification is not a substitute for the real model run.

This initial suite does **not** cover fetched URLs/GitHub authentication, browser-side extraction, audio/video/live recording, translated choices, huge-resource limits, queue crashes, concurrent submissions, or LMS delivery. Those remain explicit additions in Part 09; don't claim whole-backend coverage from these five assignments. LINK_FILE currently exercises its upload branch only. The generated OOXML fixtures exercise Mark's parsers, not desktop Office rendering compatibility.

Production material is optional. No production assignments or submissions were accessed to create this suite. If adding a real incident, export only the assignment/rubric structure needed, remove identifiers, links, secrets and copyrighted/private course material as appropriate, and write new synthetic responses. Rewording alone does not anonymize real learner submissions. Record provenance and the exact reproduced failure before committing a fixture.
