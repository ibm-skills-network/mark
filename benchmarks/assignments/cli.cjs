#!/usr/bin/env node
// Intentionally outside test discovery. Only this explicit CLI spends tokens.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { buildSuite, TIERS, code } = require("./fixtures.cjs");
const {
  hash,
  fingerprint,
  evaluate,
  ordering,
  compare,
  markdown,
} = require("./report.cjs");
const root = path.resolve(__dirname, "../..");
const apiRequire = createRequire(path.join(root, "apps/api/package.json"));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (value) =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
function localUrl(value, label) {
  const u = new URL(value);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    throw new Error(
      `${label} must use loopback; production targets are not supported`,
    );
  return u;
}
function options(args) {
  const out = {};
  const allowed = new Set([
    "assignment",
    "tier",
    "repeats",
    "output",
    "timeout",
    "api",
  ]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    if (!allowed.has(key) || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error(`Unknown or incomplete option ${args[i]}`);
    out[key] = args[i + 1];
  }
  return out;
}
function database() {
  apiRequire("dotenv").config({
    path: path.join(root, "apps/api/dev.env"),
    quiet: true,
  });
  apiRequire("dotenv").config({
    path: path.join(root, "dev.env"),
    quiet: true,
  });
  if (!process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL to the local API database");
  localUrl(process.env.DATABASE_URL, "DATABASE_URL");
  const { PrismaClient } = apiRequire("@prisma/client");
  return new PrismaClient();
}
async function models(db, change = false) {
  const features = await db.aIFeature.findMany({
    include: {
      assignments: {
        where: { isActive: true },
        orderBy: { priority: "desc" },
        include: { model: true },
      },
    },
  });
  if (!features.length)
    throw new Error(
      "No AI features found; migrate/seed the local database first",
    );
  if (change) {
    const luna = await db.lLMModel.findUnique({
      where: { modelKey: "gpt-6-luna" },
    });
    if (!luna?.isActive)
      throw new Error(
        "GPT-6 Luna is absent/inactive; apply repository migrations first",
      );
    await db.$transaction(async (tx) => {
      for (const f of features.filter((f) => f.requiresModel)) {
        await tx.aIFeature.update({
          where: { id: f.id },
          data: { defaultModelKey: "gpt-6-luna" },
        });
        await tx.lLMFeatureAssignment.updateMany({
          where: { featureId: f.id, isActive: true },
          data: { isActive: false, deactivatedAt: new Date() },
        });
        await tx.lLMFeatureAssignment.upsert({
          where: { featureId_modelId: { featureId: f.id, modelId: luna.id } },
          create: {
            featureId: f.id,
            modelId: luna.id,
            isActive: true,
            assignedBy: "local-benchmark",
          },
          update: {
            isActive: true,
            priority: 0,
            deactivatedAt: null,
            assignedBy: "local-benchmark",
            assignedAt: new Date(),
          },
        });
      }
    });
    console.log(
      "Local feature defaults and assignments set to gpt-6-luna. Restart API and workers to clear their model caches before running.",
    );
    return;
  }
  const resolved = Object.fromEntries(
    features
      .filter((f) => f.isActive && f.requiresModel)
      .map((f) => [
        f.featureKey,
        f.assignments[0]?.model.modelKey || f.defaultModelKey || "gpt-6-luna",
      ]),
  );
  const wrong = Object.entries(resolved).filter(([, m]) => m !== "gpt-6-luna");
  if (wrong.length)
    throw new Error(
      `Non-Luna feature assignments: ${JSON.stringify(wrong)}. Run set-model, then restart API/workers.`,
    );
  return resolved;
}
const config = {
  numAttempts: 10,
  attemptsBeforeCoolDown: 10,
  retakeAttemptCoolDownMinutes: 0,
  passingGrade: 60,
  displayOrder: "DEFINED",
  graded: true,
  questionVariationNumber: 1,
  questionDisplay: "ALL_PER_PAGE",
  showQuestions: true,
  showSubmissionFeedback: true,
  showAssignmentScore: true,
  showQuestionScore: true,
  correctAnswerVisibility: "ALWAYS",
  numberOfQuestionsPerAttempt: null,
  timeEstimateMinutes: 30,
  allotedTimeMinutes: 120,
  attemptsPerTimeRange: null,
  attemptsTimeRangeHours: null,
};
function client(base, groupId) {
  localUrl(base, "API URL");
  return async (
    method,
    route,
    body,
    session = {
      role: "admin",
      userId: "benchmark-author@local.invalid",
      assignmentId: 0,
    },
  ) => {
    const response = await fetch(new URL(route, base), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(120000),
      headers: {
        "user-session": JSON.stringify({
          ...session,
          groupId,
          gradingCallbackRequired: false,
        }),
        ...(body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw.slice(0, 500) };
    }
    if (!response.ok) {
      const error = new Error(
        `${method} ${route}: HTTP ${response.status}: ${JSON.stringify(data).slice(0, 1000)}`,
      );
      error.status = response.status;
      throw error;
    }
    return data;
  };
}
async function until(fn, timeout, label) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await pause(1500);
  }
  throw new Error(
    `Timed out waiting for ${label}; this is a failed benchmark, not a zero score`,
  );
}
async function validate(suite) {
  const assert = require("node:assert/strict");
  assert.equal(suite.assignments.length, 5);
  for (const assignment of suite.assignments)
    for (const question of assignment.questions) {
      assert.equal(question.submissions.length, 3);
      assert.equal(
        question.expected?.length || Object.keys(question.ranges).length,
        3,
      );
      if (question.definition.scoring)
        assert.equal(
          question.definition.scoring.rubrics.reduce(
            (n, r) => n + Math.max(...r.criteria.map((c) => c.points)),
            0,
          ),
          question.definition.totalPoints,
        );
      for (const submission of question.submissions)
        for (const file of submission.files || [])
          assert.ok(suite.assets[file]?.bytes.length);
    }
  assert.ok(code[0].length > 1000);
  assert.equal(code[0].slice(0, 200), code[2].slice(0, 200));
  assert.notEqual(code[0].slice(200), code[2].slice(200));
  // Parse generated OOXML/notebooks, independent of the grading runner.
  const JSZip = apiRequire("jszip");
  const xlsx = apiRequire("xlsx");
  const { PDFDocument } = apiRequire("pdf-lib");
  for (const tier of TIERS) {
    for (const ext of ["zip", "docx", "pptx"]) {
      const z = await JSZip.loadAsync(suite.assets[`${tier}.${ext}`].bytes, {
        checkCRC32: true,
      });
      assert.ok(Object.keys(z.files).length > 1);
    }
    const wb = xlsx.read(suite.assets[`${tier}.xlsx`].bytes);
    assert.equal(wb.Sheets.Ledger.B217.v, -125);
    assert.equal(
      (
        await PDFDocument.load(suite.assets[`${tier}.pdf`].bytes)
      ).getPageCount(),
      3,
    );
    assert.equal(
      JSON.parse(suite.assets[`${tier}.ipynb`].bytes).cells.length,
      3,
    );
  }
  console.log(
    `Validated 5 assignments, 15 learner submissions, 45 question responses, ${Object.keys(suite.assets).length} assets. Suite hash: ${fingerprint(suite)}`,
  );
}
async function run(suite, opts) {
  const repeats = Number(opts.repeats || 1),
    timeout = Number(opts.timeout || 900) * 1000;
  if (
    !Number.isInteger(repeats) ||
    repeats < 1 ||
    repeats > 10 ||
    !Number.isFinite(timeout) ||
    timeout < 1000
  )
    throw new Error("Repeats must be 1–10; timeout must be positive seconds");
  const assignments = suite.assignments.filter(
    (a) => !opts.assignment || a.key === opts.assignment,
  );
  const tiers = TIERS.filter((t) => !opts.tier || t === opts.tier);
  if (!assignments.length || !tiers.length)
    throw new Error("Unknown assignment or tier");
  const base = opts.api || "http://127.0.0.1:4222";
  localUrl(base, "API URL");
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${require("node:crypto").randomUUID().slice(0, 8)}`;
  const output = path.resolve(
    opts.output || path.join(__dirname, "runs", runId),
  );
  fs.mkdirSync(output, { recursive: true });
  const reportPath = path.join(output, "report.json");
  if (fs.existsSync(reportPath))
    throw new Error(
      "Output already contains a report; choose a fresh directory",
    );
  let revision = "unknown";
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {}
  const report = {
    schemaVersion: 1,
    fixtureDefinitions: suite.assignments,
    runId,
    revision,
    dirty:
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim() !== "",
    suiteHash: fingerprint(suite),
    model: suite.model,
    startedAt: new Date().toISOString(),
    base,
    selection: { assignments: assignments.map((a) => a.key), tiers, repeats },
    assets: Object.fromEntries(
      Object.entries(suite.assets).map(([k, v]) => [
        k,
        { sha256: hash(v.bytes), bytes: v.bytes.length },
      ]),
    ),
    assignments: [],
    records: [],
    errors: [],
  };
  const persist = () => {
    fs.writeFileSync(`${reportPath}.tmp`, json(report), { mode: 0o600 });
    fs.renameSync(`${reportPath}.tmp`, reportPath);
    fs.writeFileSync(path.join(output, "summary.md"), markdown(report), {
      mode: 0o600,
    });
  };
  persist();
  const db = database();
  const api = client(base, `benchmark-${runId}`);
  try {
    report.features = await models(db);
    for (let repeat = 1; repeat <= repeats; repeat++)
      for (const assignment of assignments) {
        const name = `[BENCH ${runId}] ${assignment.name} #${repeat}`;
        const created = await api("POST", "/api/v1/admin/assignments", {
          name,
          type: "AI_GRADED",
          groupId: `benchmark-${runId}`,
        });
        const id = created.id;
        if (!Number.isInteger(id))
          throw new Error("Creation returned no assignment ID");
        const mapping = { key: assignment.key, id, repeat, name };
        report.assignments.push(mapping);
        persist();
        // Ensure the read-only audit connection is the same database as the API.
        const row = await db.assignment.findUnique({ where: { id } });
        if (row?.name !== name)
          throw new Error(
            "API and benchmark DATABASE_URL do not point to the same database",
          );
        await api("POST", `/api/v1/admin/assignments/${id}/content`, {
          assignment: {
            name,
            introduction: "Synthetic local benchmark. No real learner data.",
            instructions:
              "Complete every question. Grading uses only submitted evidence.",
          },
          config,
          feedbackConfig: {
            verbosityLevel: "Detailed",
            showSubmissionFeedback: true,
            showQuestionScore: true,
            showAssignmentScore: true,
            showQuestions: true,
          },
          gradingCriteria:
            "Apply each rubric independently. Do not infer missing work from the quality of other answers.",
          questions: assignment.questions.map((q) => q.definition),
        });
        const published = await until(
          async () => {
            const a = await db.assignment.findUnique({
              where: { id },
              include: {
                questions: {
                  where: { isDeleted: false },
                  orderBy: { id: "asc" },
                },
              },
            });
            return a?.published && a.currentVersionId ? a : null;
          },
          timeout,
          "assignment publication",
        );
        if (published.questions.length !== assignment.questions.length)
          throw new Error("Published question count mismatch");
        mapping.versionId = published.currentVersionId;
        mapping.questionIds = published.questions.map((q) => q.id);
        persist();
        const scenarios = tiers.map((tier) => ({ tier }));
        if (assignment.key === "policy" && tiers.includes("great"))
          scenarios.push(
            { tier: "great", fault: "corrupt-pdf" },
            { tier: "great", fault: "missing-object" },
            { tier: "great", fault: "mixed-files" },
          );
        for (const scenario of scenarios) {
          const { tier, fault } = scenario;
          const ti = TIERS.indexOf(tier);
          const record = {
            assignment: assignment.key,
            assignmentId: id,
            repeat,
            tier,
            ...(fault ? { fault } : {}),
            errors: [],
          };
          report.records.push(record);
          persist();
          const start = Date.now();
          const session = {
            role: "learner",
            userId: `bench-${runId}-${assignment.key}-${repeat}-${tier}${fault ? `-${fault}` : ""}@local.invalid`,
            assignmentId: id,
          };
          record.userId = session.userId;
          let responses;
          try {
            const before = await db.aIUsage.findMany({
              where: { assignmentId: id },
            });
            const attempt = await api(
              "POST",
              `/api/v2/assignments/${id}/attempts`,
              undefined,
              session,
            );
            record.attemptId = attempt.id;
            if (!Number.isInteger(attempt.id)) throw new Error("No attempt ID");
            persist();
            const route = `/api/v2/assignments/${id}/attempts/${attempt.id}`;
            const view = await api("GET", route, undefined, session);
            if (view.questions?.length !== mapping.questionIds.length)
              throw new Error("Learner view missing questions");
            if (view.questions.some((q) => !mapping.questionIds.includes(q.id)))
              throw new Error(
                "Learner question identities differ from the published fixture",
              );
            responses = [];
            record.responses = responses;
            record.uploads = [];
            for (const [qi, question] of assignment.questions.entries()) {
              const qid = mapping.questionIds[qi];
              const source = question.submissions[ti];
              const response = {
                id: qid,
                question: question.definition.question,
                language: "en",
              };
              if (source.files) {
                response.learnerFileResponse = [];
                for (const assetName of source.files) {
                  const asset = suite.assets[assetName],
                    filename = `submission.${assetName.split(".").pop()}`;
                  const form = new FormData();
                  form.set(
                    "file",
                    new Blob(
                      [
                        fault === "corrupt-pdf" && qi === 0
                          ? Buffer.from("%PDF-1.7\ntruncated")
                          : asset.bytes,
                      ],
                      { type: asset.mime },
                    ),
                    filename,
                  );
                  form.set("uploadType", "learner");
                  form.set(
                    "context",
                    JSON.stringify({ assignmentId: id, questionId: qid }),
                  );
                  const uploaded = await api(
                    "POST",
                    "/api/v1/files/direct-upload",
                    form,
                    session,
                  );
                  if (!uploaded.key || !uploaded.bucket)
                    throw new Error("Upload returned no storage identity");
                  record.uploads.push({ ...uploaded, questionId: qid });
                  persist();
                  response.learnerFileResponse.push({
                    filename,
                    fileType: asset.mime,
                    mimeType: asset.mime,
                    content: "",
                    key:
                      fault === "missing-object" && qi === 0
                        ? `${uploaded.key}.does-not-exist`
                        : uploaded.key,
                    bucket: uploaded.bucket,
                  });
                  if (fault === "mixed-files" && qi === 0) {
                    const broken = new FormData();
                    broken.set(
                      "file",
                      new Blob([Buffer.from("%PDF-1.7\ntruncated")], {
                        type: "application/pdf",
                      }),
                      "appendix.pdf",
                    );
                    broken.set("uploadType", "learner");
                    broken.set(
                      "context",
                      JSON.stringify({ assignmentId: id, questionId: qid }),
                    );
                    const extra = await api(
                      "POST",
                      "/api/v1/files/direct-upload",
                      broken,
                      session,
                    );
                    record.uploads.push({ ...extra, questionId: qid });
                    persist();
                    response.learnerFileResponse.push({
                      filename: "appendix.pdf",
                      fileType: "application/pdf",
                      mimeType: "application/pdf",
                      content: "",
                      key: extra.key,
                      bucket: extra.bucket,
                    });
                  }
                }
              } else Object.assign(response, source);
              responses.push(response);
            }
            let submissionError;
            try {
              record.accepted = await api(
                "PATCH",
                route,
                {
                  submitted: true,
                  responsesForQuestions: responses,
                  language: "en",
                },
                session,
              );
            } catch (e) {
              if (!fault || ![400, 422].includes(e.status)) throw e;
              submissionError = e.message;
            }
            const terminal = await until(
              async () => {
                const a = await db.assignmentAttempt.findUnique({
                  where: { id: attempt.id },
                  include: { gradingProgress: true, questionResponses: true },
                });
                return submissionError ||
                  a?.gradingProgress?.status === "FAILED" ||
                  (a?.grade !== null && a?.submitted)
                  ? a
                  : null;
              },
              timeout,
              "terminal grading state",
            );
            record.progress = terminal.gradingProgress;
            record.grade = terminal.grade;
            record.submissionError = submissionError;
            const after = await db.aIUsage.findMany({
              where: { assignmentId: id },
            });
            record.usage = after
              .map((u) => {
                const b = before.find((v) => v.usageType === u.usageType);
                return {
                  type: u.usageType,
                  model: u.modelKey,
                  calls: Number(u.usageCount - (b?.usageCount || 0n)),
                  tokensIn: Number(u.tokensIn - (b?.tokensIn || 0n)),
                  tokensOut: Number(u.tokensOut - (b?.tokensOut || 0n)),
                };
              })
              .filter((u) => u.calls || u.tokensIn || u.tokensOut);
            record.audits = await db.gradingAudit.findMany({
              where: { assignmentId: id, timestamp: { gte: new Date(start) } },
            });
            if (fault) {
              if (terminal.grade !== null || terminal.questionResponses.length)
                record.errors.push(
                  "Required-source failure committed a grade or partial question grades",
                );
              if (
                !submissionError &&
                terminal.gradingProgress?.status !== "FAILED"
              )
                record.errors.push("Failure has no explicit failed state");
            } else {
              if (terminal.gradingProgress?.status === "FAILED")
                throw new Error(
                  `Grading failed: ${terminal.gradingProgress.error}`,
                );
              record.completed = await api(
                "GET",
                `${route}/completed`,
                undefined,
                session,
              );
              if (record.completed.grade !== terminal.grade)
                record.errors.push(
                  "Learner-visible grade differs from persisted grade",
                );
              record.questions = assignment.questions.map((q, qi) => {
                const rows = terminal.questionResponses.filter(
                  (r) => r.questionId === mapping.questionIds[qi],
                );
                const errors = evaluate(q, ti, rows[0]);
                if (rows.length !== 1)
                  errors.push(
                    `Expected one committed response, found ${rows.length}`,
                  );
                record.errors.push(...errors.map((e) => `${q.key}: ${e}`));
                return { key: q.key, ...rows[0], errors };
              });
              const total = record.questions.reduce(
                  (sum, q) => sum + (q.points || 0),
                  0,
                ),
                max = assignment.questions.reduce(
                  (sum, q) => sum + q.definition.totalPoints,
                  0,
                );
              if (
                !Number.isFinite(terminal.grade) ||
                Math.abs(terminal.grade - total / max) > 0.011
              )
                record.errors.push(
                  "Assignment grade does not reconcile with question scores",
                );
              const gradingUsage = record.usage.filter((u) =>
                ["ASSIGNMENT_GRADING", "GRADING_VALIDATION"].includes(u.type),
              );
              if (
                assignment.deterministic &&
                gradingUsage.some((u) => u.calls > 0)
              )
                record.errors.push("Deterministic grading made model calls");
              if (
                !assignment.deterministic &&
                !gradingUsage.some((u) => u.calls > 0 && u.tokensIn > 0)
              )
                record.errors.push(
                  "No recorded real LLM grading usage (cache hit or missing telemetry)",
                );
              if (
                record.usage.some((u) => u.calls > 0 && u.model !== suite.model)
              )
                record.errors.push("Actual usage includes an unexpected model");
              if (assignment.deterministic && tier === "great") {
                // A retried browser submit must not create another authoritative result.
                try {
                  record.replay = await api(
                    "PATCH",
                    route,
                    {
                      submitted: true,
                      responsesForQuestions: responses,
                      language: "en",
                    },
                    session,
                  );
                } catch (e) {
                  if (![400, 409].includes(e.status)) throw e;
                  record.replay = { status: e.status };
                }
                const replayed = await db.assignmentAttempt.findUnique({
                  where: { id: attempt.id },
                  include: { questionResponses: true },
                });
                if (
                  replayed.grade !== terminal.grade ||
                  JSON.stringify(
                    replayed.questionResponses
                      .map((r) => [r.id, r.points])
                      .sort(),
                  ) !==
                    JSON.stringify(
                      terminal.questionResponses
                        .map((r) => [r.id, r.points])
                        .sort(),
                    )
                )
                  record.errors.push(
                    "Duplicate submission changed the authoritative result",
                  );
              }
              if (record.questions.some((q) => q.metadata?.cached))
                record.errors.push(
                  "A question used a cached grade instead of a real model call",
                );
            }
          } catch (error) {
            record.errors.push(error.message);
          } finally {
            // Preserve failure evidence too; never lose a partially executed attempt.
            if (record.attemptId) {
              try {
                record.finalState = await db.assignmentAttempt.findUnique({
                  where: { id: record.attemptId },
                  include: { gradingProgress: true, questionResponses: true },
                });
                record.audits = await db.gradingAudit.findMany({
                  where: {
                    assignmentId: id,
                    timestamp: { gte: new Date(start) },
                  },
                });
              } catch (e) {
                record.errors.push(
                  `Failed to collect terminal evidence: ${e.message}`,
                );
              }
            }
          }
          record.durationMs = Date.now() - start;
          persist();
          console.log(
            `${assignment.key}/${tier}${fault ? `/${fault}` : ""} grade=${record.grade ?? "none"} ${record.errors.length ? "FAIL: " + record.errors.join("; ") : "PASS"}`,
          );
          if (record.errors.some((e) => /Timed out/.test(e)))
            throw new Error(
              "Stopped after timeout to avoid accumulating queued LLM work. Inspect the recorded attempt before rerunning.",
            );
        }
      }
    report.errors.push(...ordering(report.records));
    report.completedAt = new Date().toISOString();
  } catch (error) {
    report.errors.push(error.message);
  } finally {
    persist();
    await db.$disconnect();
  }
  console.log(`Report: ${reportPath}`);
  if (report.errors.length || report.records.some((r) => r.errors.length)) {
    console.error(report.errors.join("\n"));
    process.exitCode = 1;
  }
}
async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help") {
    console.log(
      "Manual assignment benchmarks (real LLM calls; never part of CI).\n  validate\n  export <directory>\n  set-model                 Set LOCAL feature assignments/defaults to GPT-6 Luna\n  run [--assignment deterministic|software|data|policy|release] [--tier poor|mediocre|great] [--repeats 1] [--output directory] [--timeout seconds] [--api http://127.0.0.1:4222]\n  compare <before/report.json> <after/report.json>",
    );
    return;
  }
  if (command === "compare") {
    if (args.length !== 2) throw new Error("Provide two report paths");
    console.log(
      json(compare(...args.map((f) => JSON.parse(fs.readFileSync(f, "utf8"))))),
    );
    return;
  }
  if (command === "set-model") {
    const db = database();
    try {
      await models(db, true);
    } finally {
      await db.$disconnect();
    }
    return;
  }
  const suite = await buildSuite();
  if (command === "validate") {
    await validate(suite);
    return;
  }
  if (command === "export") {
    if (args.length !== 1) throw new Error("Provide an empty output directory");
    fs.mkdirSync(args[0], { recursive: true });
    if (fs.readdirSync(args[0]).length)
      throw new Error("Export directory must be empty");
    for (const [name, a] of Object.entries(suite.assets))
      fs.writeFileSync(path.join(args[0], name), a.bytes);
    fs.writeFileSync(
      path.join(args[0], "suite.json"),
      json({
        ...suite,
        assets: Object.fromEntries(
          Object.entries(suite.assets).map(([k, v]) => [
            k,
            { mime: v.mime, sha256: hash(v.bytes) },
          ]),
        ),
      }),
    );
    return;
  }
  if (command === "run") {
    await run(suite, options(args));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { localUrl, options, validate };
