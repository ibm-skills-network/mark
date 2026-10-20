const crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function fingerprint(suite) {
  return hash(
    JSON.stringify({
      version: suite.version,
      assignments: suite.assignments,
      assets: Object.fromEntries(
        Object.entries(suite.assets).map(([k, v]) => [k, hash(v.bytes)]),
      ),
    }),
  );
}
function evaluate(question, tierIndex, response) {
  const errors = [];
  if (!response || !Number.isFinite(response.points))
    return ["Missing finite question score"];
  const max = question.definition.totalPoints;
  if (response.points < 0 || response.points > max)
    errors.push("Score outside question bounds");
  if (question.expected && response.points !== question.expected[tierIndex])
    errors.push(
      `Expected exactly ${question.expected[tierIndex]}, received ${response.points}`,
    );
  if (question.ranges) {
    const [lo, hi] = question.ranges[["poor", "mediocre", "great"][tierIndex]];
    if (response.points < lo * max || response.points > hi * max)
      errors.push(
        `Score ${response.points}/${max} outside reference band ${lo * 100}–${hi * 100}%`,
      );
    if (!response.feedback || JSON.stringify(response.feedback).length < 10)
      errors.push("Missing useful feedback");
  }
  return errors;
}
function ordering(records) {
  const errors = [];
  const groups = Map.groupBy(
    records.filter((r) => !r.fault),
    (r) => `${r.assignment}/${r.repeat}`,
  );
  for (const [key, rows] of groups) {
    const tiers = ["poor", "mediocre", "great"].map((t) =>
      rows.find((r) => r.tier === t),
    );
    if (
      tiers.every((r) => Number.isFinite(r?.grade)) &&
      !(tiers[0].grade < tiers[1].grade && tiers[1].grade < tiers[2].grade)
    )
      errors.push(`${key}: poor < mediocre < great ordering failed`);
  }
  return errors;
}
function compare(before, after) {
  if (before.suiteHash !== after.suiteHash)
    throw new Error(
      "Different fixture/rubric hashes; establish a new baseline instead of comparing incompatible suites",
    );
  if (before.model !== after.model)
    throw new Error("Different requested models");
  if (!before.completedAt || !after.completedAt)
    throw new Error("Cannot compare incomplete runs");
  const key = (r) =>
    `${r.assignment}/${r.tier}/${r.repeat}/${r.fault || "normal"}`;
  const old = new Map(before.records.map((r) => [key(r), r]));
  if (
    old.size !== after.records.length ||
    after.records.some((r) => !old.has(key(r)))
  )
    throw new Error("Different assignment/tier/repeat selections");
  return after.records.map((r) => {
    const b = old.get(key(r));
    return {
      case: key(r),
      before: b.grade,
      after: r.grade,
      gradeDelta:
        Number.isFinite(b.grade) && Number.isFinite(r.grade)
          ? r.grade - b.grade
          : null,
      latencyDeltaMs: r.durationMs - b.durationMs,
      beforeErrors: b.errors,
      afterErrors: r.errors,
      questionDeltas: (r.questions || []).map((q) => ({
        key: q.key,
        before: b.questions?.find((v) => v.key === q.key)?.points,
        after: q.points,
      })),
    };
  });
}
function markdown(report) {
  const cell = (value) =>
    String(value ?? "—")
      .replaceAll("|", "\\|")
      .replaceAll("\n", " ");
  return [
    `# Assignment benchmark ${report.runId}`,
    "",
    `Revision: ${report.revision}${report.dirty ? " (dirty worktree)" : ""}. Model: ${report.model}.`,
    `Fixture hash: ${report.suiteHash}.`,
    `State: ${report.completedAt ? "finished" : "incomplete"}. Full evidence: [report.json](report.json).`,
    "",
    "| Assignment | Tier / scenario | Grade | Seconds | Grading calls | Result |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...report.records.map(
      (r) =>
        `| ${cell(r.assignment)} | ${cell(r.tier + (r.fault ? " / " + r.fault : ""))} | ${Number.isFinite(r.grade) ? (r.grade * 100).toFixed(1) + "%" : "—"} | ${((r.durationMs || 0) / 1000).toFixed(1)} | ${(r.usage || []).filter((u) => ["ASSIGNMENT_GRADING", "GRADING_VALIDATION"].includes(u.type)).reduce((n, u) => n + u.calls, 0)} | ${cell(r.errors.length ? r.errors.join("; ") : r.durationMs === undefined ? "pending" : "PASS")} |`,
    ),
    "",
    ...report.errors.map((e) => `- ${cell(e)}`),
    "",
    "Reference score bands need human review. A passing run alone does not establish production reliability.",
    "",
  ].join("\n");
}
module.exports = { hash, fingerprint, evaluate, ordering, compare, markdown };
