const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseGradingJob,
  parseLegacySubmission,
  GradingContractError,
} = require("../dist");
const payload = () => ({
  gradingJobId: "run-1",
  attemptId: 1,
  assignmentId: 2,
  userSession: {
    userId: "synthetic-learner",
    role: "learner",
    gradingCallbackRequired: false,
  },
  updateDto: { submitted: true, responsesForQuestions: [] },
});
const roundTrip = (value) => JSON.parse(JSON.stringify(value));

test("legacy JSON messages normalize to v1 without changing answer meaning", () => {
  const input = payload();
  input.updateDto.responsesForQuestions = [
    {
      id: 1,
      learnerChoices: ['"2"', "2", 0, "你好"],
      learnerAnswerChoice: false,
    },
    { id: 2, learnerChoices: [], learnerTextResponse: "" },
    {
      id: 3,
      learnerFileResponse: [
        {
          filename: "notebook.ipynb",
          content: { cells: [{ source: "été" }] },
          key: "owned-key",
          bucket: "synthetic",
        },
      ],
    },
    {
      id: 4,
      learnerPresentationResponse: {
        transcript: "hi",
        slidesData: [
          { slideNumber: 1, slideText: "late evidence", slideImage: "" },
        ],
      },
    },
  ];
  const parsed = parseGradingJob(roundTrip(input));
  assert.equal(parsed.schemaVersion, 1);
  assert.deepEqual(parsed.updateDto, input.updateDto);
  assert.deepEqual(parseGradingJob(roundTrip(parsed)), parsed);
  assert.equal(Object.hasOwn(parsed, "authCookie"), false);
});

test("preserves the entire long source including evidence after 200 characters", () => {
  const input = payload();
  const content =
    "// header\n".repeat(2000) + "@OneToMany(fetch = FetchType.EAGER)";
  input.updateDto.responsesForQuestions = [
    { id: 1, learnerFileResponse: [{ filename: "Customer.java", content }] },
  ];
  assert.equal(
    parseGradingJob(roundTrip(input)).updateDto.responsesForQuestions[0]
      .learnerFileResponse[0].content,
    content,
  );
});

test("rejects malformed submissions, duplicate IDs, non-finite IDs and type confusion", () => {
  for (const updateDto of [
    null,
    {},
    { submitted: false, responsesForQuestions: [] },
    { submitted: true, responsesForQuestions: [{ id: 1 }, { id: 1 }] },
    { submitted: true, responsesForQuestions: [{ id: "1" }] },
    { submitted: true, responsesForQuestions: [{ id: Infinity }] },
    {
      submitted: true,
      responsesForQuestions: [{ id: 1, learnerAnswerChoice: "false" }],
    },
    {
      submitted: true,
      responsesForQuestions: [{ id: 1, learnerFileResponse: {} }],
    },
  ])
    assert.throws(() => parseLegacySubmission(updateDto), GradingContractError);
});

test("unknown versions never downgrade; v1 envelope is strict, legacy metadata is retained", () => {
  for (const schemaVersion of [0, 2, "1", null, undefined]) {
    assert.throws(
      () => parseGradingJob({ ...payload(), schemaVersion }),
      GradingContractError,
    );
  }
  assert.throws(
    () => parseGradingJob({ ...payload(), schemaVersion: 1, unexpected: true }),
    GradingContractError,
  );
  assert.equal(
    parseGradingJob({ ...payload(), obsoleteMetadata: true }).schemaVersion,
    1,
  );
});

test("failure diagnostics expose neither content nor callback credentials", () => {
  const input = {
    ...payload(),
    authCookie: "private-cookie",
    attemptId: "private-answer",
  };
  assert.throws(
    () => parseGradingJob(input),
    (error) => {
      assert.equal(error.retryable, false);
      assert.equal(error.code, "INVALID_GRADING_CONTRACT");
      assert.doesNotMatch(
        error.message + JSON.stringify(error),
        /private-cookie|private-answer/,
      );
      return true;
    },
  );
});

test("learner grading identity cannot be replaced with an author or missing user", () => {
  for (const userSession of [
    { role: "learner" },
    { userId: "u", role: "author" },
  ]) {
    assert.throws(
      () => parseGradingJob({ ...payload(), userSession }),
      GradingContractError,
    );
  }
});
