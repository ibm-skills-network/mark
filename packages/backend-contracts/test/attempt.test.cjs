const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  normalizeDraftAnswers,
  learnerDefinition,
  gradePinnedChoice,
  saveDraftSchema,
} = require("../dist");
const choices = [
  {
    id: randomUUID(),
    choice: '"0"',
    isCorrect: true,
    points: 2,
    feedback: "secret",
  },
  { id: randomUUID(), choice: "0", isCorrect: false, points: 1 },
];
const definition = {
  schemaVersion: 1,
  assignmentVersionId: 1,
  assignment: { name: "Pinned", instructions: "Original" },
  questions: [
    {
      id: 1,
      versionId: 2,
      variantId: null,
      question: "q",
      type: "SINGLE_CORRECT",
      totalPoints: 2,
      choices,
      configuration: { scoring: { secret: "rubric" } },
    },
  ],
};
test("quoted and numeric labels map exactly once at the compatibility boundary", () => {
  assert.deepEqual(
    normalizeDraftAnswers(definition, [
      { questionId: 1, choiceLabels: ['"0"'] },
    ])[0].choiceIds,
    [choices[0].id],
  );
  assert.deepEqual(
    normalizeDraftAnswers(definition, [{ questionId: 1, choiceLabels: [0] }])[0]
      .choiceIds,
    [choices[1].id],
  );
  assert.throws(() =>
    normalizeDraftAnswers(definition, [
      { questionId: 1, choiceLabels: ["translated"] },
    ]),
  );
});
test("duplicate labels and cross-question IDs fail explicitly", () => {
  const ambiguous = structuredClone(definition);
  ambiguous.questions[0].choices[1].choice = '"0"';
  assert.throws(() =>
    normalizeDraftAnswers(ambiguous, [
      { questionId: 1, choiceLabels: ['"0"'] },
    ]),
  );
  assert.throws(() =>
    normalizeDraftAnswers(definition, [
      { questionId: 1, choiceIds: [randomUUID()] },
    ]),
  );
  assert.throws(() =>
    normalizeDraftAnswers(definition, [{ questionId: 1 }, { questionId: 1 }]),
  );
});
test("choice IDs survive translated labels and shuffled order, without text scoring", () => {
  const translated = structuredClone(definition);
  translated.questions[0].choices.reverse();
  translated.questions[0].choices[1].choice = "零";
  assert.equal(
    gradePinnedChoice(translated.questions[0], [choices[0].id]).totalPoints,
    2,
  );
  assert.throws(() => gradePinnedChoice(translated.questions[0], ['"0"']));
});
test("false, zero, empty text and the full tail of a long response survive", () => {
  const d = structuredClone(definition);
  d.questions[0].type = "TEXT";
  const a = [
    {
      questionId: 1,
      boolean: false,
      number: 0,
      text: "x".repeat(20000) + "TAIL",
    },
  ];
  assert.deepEqual(normalizeDraftAnswers(d, a), a);
  assert.equal(
    saveDraftSchema.parse({
      operationId: randomUUID(),
      expectedRevision: 0,
      answers: a,
    }).answers[0].text.length,
    20004,
  );
});
test("learner projection does not disclose correct answers, points per choice or rubric", () => {
  const projected = JSON.stringify(learnerDefinition(definition));
  for (const secret of ["isCorrect", "feedback", "rubric", "configuration"])
    assert.equal(projected.includes(secret), false);
});
test("loss-per-mistake scoring uses pinned configuration and respects question max", () => {
  const q = structuredClone(definition.questions[0]);
  q.type = "MULTIPLE_CORRECT";
  q.configuration.scoring = { type: "LOSS_PER_MISTAKE" };
  assert.equal(
    gradePinnedChoice(
      q,
      choices.map((c) => c.id),
    ).totalPoints,
    1,
  );
  assert.throws(() => gradePinnedChoice(q, [choices[0].id, choices[0].id]));
});
