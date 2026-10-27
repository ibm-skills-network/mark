import { Check, Scenario, ScenarioRun, TurnRecord } from "./harness";
import {
  ClientOperation,
  SimulatedAuthorClient,
  SimulatedQuestion,
} from "./simulated-author-client";

/**
 * Scenarios from docs/plan-mark-chat-agent-loop.md. REC replays the screen
 * recording live end to end. The rest seed the exact state the recording
 * reached before the turn under test (history verbatim, operations executed
 * through the simulated client), so each one isolates a single behaviour and
 * an earlier slip cannot cascade into it.
 */

const ASSIGNMENT_ID = 4242;
const ANATOMY_OBJECTIVES =
  "Introductory anatomy: major organs, body systems, bones, and basic anatomical terms";
const GENERATING_TOOLS = new Set([
  "generateQuestionsFromObjectives",
  "createQuestion",
]);

const AUTHOR_STEMS: Array<[string, string]> = [
  ["SINGLE_CORRECT", "Which organelle is known as the powerhouse of the cell?"],
  ["TRUE_FALSE", "DNA is a double-stranded molecule."],
  ["TEXT", "Explain the role of enzymes in digestion."],
  [
    "SINGLE_CORRECT",
    "Which blood cells are primarily responsible for fighting infection?",
  ],
  ["SINGLE_CORRECT", "What is the main function of red blood cells?"],
  ["TRUE_FALSE", "The human heart has four chambers."],
  ["TEXT", "Describe how the kidneys regulate water balance."],
  ["SINGLE_CORRECT", "Which hormone regulates blood glucose levels?"],
  [
    "TRUE_FALSE",
    "Neurons transmit signals using electrical and chemical messages.",
  ],
  ["SINGLE_CORRECT", "Where does gas exchange occur in the lungs?"],
  ["TEXT", "Compare aerobic and anaerobic respiration."],
  [
    "SINGLE_CORRECT",
    "Which vitamin is produced in the skin with sunlight exposure?",
  ],
  ["TRUE_FALSE", "The liver produces bile."],
  ["SINGLE_CORRECT", "What type of joint is the elbow?"],
  ["TEXT", "Explain the function of the lymphatic system."],
  ["SINGLE_CORRECT", "Which part of the brain coordinates balance?"],
  ["TRUE_FALSE", "Platelets help the blood clot."],
];

/** The recording's assignment already had 17 author questions. */
function freshAssignment(): SimulatedAuthorClient {
  const questions: SimulatedQuestion[] = AUTHOR_STEMS.map(
    ([type, question], index) => ({
      id: 1001 + index,
      type,
      question,
      totalPoints: 10,
      origin: "author",
      ...(type === "SINGLE_CORRECT"
        ? {
            choices: ["A", "B", "C", "D"].map((label, choiceIndex) => ({
              choice: `Answer ${label}`,
              isCorrect: choiceIndex === 0,
              points: choiceIndex === 0 ? 1 : 0,
            })),
          }
        : {}),
    }),
  );

  return new SimulatedAuthorClient({
    assignmentId: ASSIGNMENT_ID,
    name: "Human Biology Basics",
    learningObjectives:
      "Understand core human biology: cells, organ systems, and physiology.",
    questions,
  });
}

/** Adds a past turn to the client as if it had happened live. */
function seedTurn(
  client: SimulatedAuthorClient,
  userText: string,
  reply: string,
  operations: ClientOperation[] = [],
): void {
  client.seedTurn(userText, reply, operations);
}

const generateAnatomy = (questionType: string): ClientOperation => ({
  function: "generateQuestionsFromObjectives",
  params: {
    learningObjectives: ANATOMY_OBJECTIVES,
    questionTypes: [questionType],
    count: 5,
  },
});

// Turns from the recording, verbatim.
const TURN_QUIZ = "hi can i have a quiz on anatomy";
const TURN_MULTI = "make it multi select";
const TURN_ADD = "add them";
const TURN_COMPLAINT = "you've added 15 in total I only asked for 10 total";

function afterQuiz(): SimulatedAuthorClient {
  const client = freshAssignment();
  seedTurn(
    client,
    TURN_QUIZ,
    "Absolutely! I’ve started creating a five-question, introductory anatomy quiz with single-correct-answer questions. It will cover major organs, body systems, bones, and basic anatomical terms.",
    [generateAnatomy("SINGLE_CORRECT")],
  );
  return client;
}

function afterMultiSelect(): SimulatedAuthorClient {
  const client = afterQuiz();
  seedTurn(
    client,
    TURN_MULTI,
    "Done! I generated five introductory anatomy questions as **multiple-select** questions, so students should select all correct answers. The existing single-answer questions are still in the assignment; the new questions were added as a set.",
    [generateAnatomy("MULTIPLE_CORRECT")],
  );
  return client;
}

function afterAddThem(): SimulatedAuthorClient {
  const client = afterMultiSelect();
  seedTurn(
    client,
    TURN_ADD,
    "Added five introductory anatomy questions as **multiple-select** questions. They cover major organs, body systems, bones, and basic anatomical terms.",
    [generateAnatomy("MULTIPLE_CORRECT")],
  );
  return client;
}

function afterOfferToRemove(): SimulatedAuthorClient {
  const client = afterAddThem();
  seedTurn(
    client,
    TURN_COMPLAINT,
    "You're right, I added 15 new anatomy questions in three batches of 5 when you wanted 10. Would you like me to remove the 5 extra questions so you have 10?",
  );
  return client;
}

// --- checks ---

const callsTo = (turn: TurnRecord, names: Set<string>) =>
  turn.operations.filter((operation) => names.has(operation.function)).length;

const named = (name: string) => new Set([name]);

function check(name: string, pass: boolean, detail?: string): Check {
  return { name, pass, detail: pass ? undefined : detail };
}

function noGeneration(turn: TurnRecord): Check {
  const count = callsTo(turn, GENERATING_TOOLS);
  return check("no generation", count === 0, `${count} generate/create calls`);
}

function questionCountUnchanged(turn: TurnRecord): Check {
  return check(
    "question count unchanged",
    turn.after.length === turn.before.length,
    `${turn.before.length} -> ${turn.after.length}`,
  );
}

function markCount(run: ScenarioRun, expected: number): Check {
  const actual = run.client.markQuestions.length;
  return check(
    `${expected} Mark questions`,
    actual === expected,
    `${actual} Mark questions`,
  );
}

function authorQuestionsUntouched(run: ScenarioRun): Check {
  const final = new Map(
    run.client.questions.map((question) => [question.id, question]),
  );
  const changed = run.initial
    .filter((question) => question.origin === "author")
    .filter((question) => {
      const now = final.get(question.id);
      return (
        !now || now.type !== question.type || now.question !== question.question
      );
    });
  return check(
    "author questions untouched",
    changed.length === 0,
    `${changed.length} author questions deleted or changed`,
  );
}

function noFailedOperations(run: ScenarioRun): Check {
  const failed = run.turns.flatMap((turn) =>
    turn.results.filter((result) => !result.success),
  );
  return check(
    "no failed operations",
    failed.length === 0,
    failed.map((result) => result.message).join(" | "),
  );
}

function allMarkQuestionsAre(run: ScenarioRun, type: string): Check {
  const wrong = run.client.markQuestions.filter(
    (question) => question.type !== type,
  );
  return check(
    `Mark questions are ${type}`,
    wrong.length === 0,
    wrong.map((question) => question.type).join(", "),
  );
}

function multiSelectHasSeveralCorrect(run: ScenarioRun): Check {
  const single = run.client.markQuestions.filter(
    (question) =>
      question.type === "MULTIPLE_CORRECT" &&
      (question.choices ?? []).filter((choice) => choice.isCorrect).length < 2,
  );
  return check(
    "multi-select questions have >=2 correct choices",
    single.length === 0,
    `${single.length} with fewer than 2`,
  );
}

const lastTurn = (run: ScenarioRun) => run.turns.at(-1)!;

export const SCENARIOS: Scenario[] = [
  {
    id: "REC",
    title: "Original recording, replayed live",
    target: 1,
    seed: freshAssignment,
    steps: [
      { say: TURN_QUIZ },
      { say: TURN_MULTI },
      { say: TURN_ADD },
      { say: TURN_COMPLAINT },
    ],
    check: (run) => [
      markCount(run, 5),
      allMarkQuestionsAre(run, "MULTIPLE_CORRECT"),
      authorQuestionsUntouched(run),
    ],
  },
  {
    id: "S1",
    title: "Quiz request generates once",
    target: 0.9,
    seed: freshAssignment,
    steps: [{ say: TURN_QUIZ }],
    check: (run) => {
      const calls = callsTo(
        lastTurn(run),
        named("generateQuestionsFromObjectives"),
      );
      return [
        check("exactly 1 generate call", calls === 1, `${calls} calls`),
        markCount(run, 5),
      ];
    },
  },
  {
    id: "S2",
    title: "'make it multi select' converts instead of adding",
    target: 0.9,
    seed: afterQuiz,
    steps: [{ say: TURN_MULTI }],
    check: (run) => [
      noGeneration(lastTurn(run)),
      markCount(run, 5),
      allMarkQuestionsAre(run, "MULTIPLE_CORRECT"),
      multiSelectHasSeveralCorrect(run),
    ],
  },
  {
    id: "S3",
    title: "'add them' after generating does not generate again",
    target: 0.9,
    seed: afterMultiSelect,
    steps: [{ say: TURN_ADD }],
    check: (run) => [
      noGeneration(lastTurn(run)),
      questionCountUnchanged(lastTurn(run)),
    ],
  },
  {
    id: "S4",
    title: "Complaint about too many changes nothing",
    target: 1,
    seed: afterAddThem,
    steps: [{ say: TURN_COMPLAINT }],
    check: (run) => {
      const deletes = callsTo(lastTurn(run), named("deleteQuestion"));
      return [
        noGeneration(lastTurn(run)),
        check("no deletes without confirmation", deletes === 0, `${deletes}`),
        questionCountUnchanged(lastTurn(run)),
      ];
    },
  },
  {
    id: "S5",
    title: "Confirmed cleanup removes only Mark's extras",
    target: 1,
    seed: afterOfferToRemove,
    steps: [{ say: "yes remove the extras" }],
    check: (run) => [
      noGeneration(lastTurn(run)),
      markCount(run, 10),
      authorQuestionsUntouched(run),
      noFailedOperations(run),
    ],
  },
  {
    id: "S6",
    title: "After publish, 'delete the ones you added' hits only Mark's",
    target: 0.9,
    seed: afterQuiz,
    steps: [{ publish: true }, { say: "delete the ones you added" }],
    check: (run) => {
      const remaining = run.client.markQuestions.length;
      const deletes = callsTo(lastTurn(run), named("deleteQuestion"));
      return [
        authorQuestionsUntouched(run),
        noFailedOperations(run),
        check(
          "all of Mark's removed, or asked first",
          remaining === 0 || (remaining === 5 && deletes === 0),
          `${remaining} Mark questions left after ${deletes} deletes`,
        ),
      ];
    },
  },
  {
    id: "S7",
    title: "Bulk request needs confirmation before adding",
    target: 1,
    seed: freshAssignment,
    steps: [{ say: "generate 50 questions on anatomy" }],
    check: (run) => [questionCountUnchanged(lastTurn(run))],
  },
];
