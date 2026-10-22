const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertQuestionGrade,
  assertGradeCommit,
  assertCommittedGrade,
  InvalidGradingResultError,
} = require("../dist");
const commit = () => ({
  schemaVersion: 1,
  attemptId: 9,
  grade: 0.75,
  expectedQuestionIds: [1, 2],
  results: [
    { questionId: 2, response: { questionId: 2, totalPoints: 5 } },
    { questionId: 1, response: { questionId: 1, totalPoints: 2.5 } },
  ],
});
test("finite zero and fractional scores pass without coercion or reordering", () => {
  assertQuestionGrade({ questionId: 1, totalPoints: 0 }, 1, 5);
  assertQuestionGrade({ questionId: 1, totalPoints: 2.5 }, 1, 5);
  assertGradeCommit(JSON.parse(JSON.stringify(commit())));
  assertCommittedGrade({ id: 9, submitted: true, grade: 0.75 }, 9, 0.75);
});
test("rejects missing, string, nonfinite, negative and excessive question scores", () => {
  for (const totalPoints of [undefined, null, "3", NaN, Infinity, -1, 6])
    assert.throws(
      () => assertQuestionGrade({ questionId: 1, totalPoints }, 1, 5),
      InvalidGradingResultError,
    );
  assert.throws(
    () => assertQuestionGrade({ questionId: 2, totalPoints: 1 }, 1, 5),
    InvalidGradingResultError,
  );
});
test("rejects incomplete, duplicate, foreign and mismatched result identities", () => {
  for (const change of [
    { results: commit().results.slice(1) },
    { results: [commit().results[0], commit().results[0]] },
    { expectedQuestionIds: [1, 1] },
    { expectedQuestionIds: [1, 3] },
    {
      results: [
        { questionId: 1, response: { questionId: 2, totalPoints: 5 } },
        commit().results[0],
      ],
    },
  ])
    assert.throws(
      () => assertGradeCommit({ ...commit(), ...change }),
      InvalidGradingResultError,
    );
});
test("rejects grades outside the unit interval before commit", () => {
  for (const grade of [NaN, Infinity, -1, 85, null, "0.5"])
    assert.throws(
      () => assertGradeCommit({ ...commit(), grade }),
      InvalidGradingResultError,
    );
});
test("read-back must identify the exact attempt and grade that was committed", () => {
  for (const row of [
    new Error("db failure"),
    { id: 9, submitted: true, grade: null },
    { id: 10, submitted: true, grade: 0.75 },
    { id: 9, submitted: false, grade: 0.75 },
    { id: 9, submitted: true, grade: 0.5 },
  ])
    assert.throws(
      () => assertCommittedGrade(row, 9, 0.75),
      InvalidGradingResultError,
    );
});
