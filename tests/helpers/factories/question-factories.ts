/**
 * Question-type factories for Playwright E2E seeding.
 *
 * Each factory returns ONE entry for the `questions` array that
 * `addContentToAssignment` (see assignment-helpers.ts) posts to
 * `POST /api/v1/admin/assignments/:id/content`. The returned shape mirrors the
 * api `QuestionContentDto` (apps/api/.../add.content.to.assignment.request.dto.ts)
 * and the canonical seeded SINGLE_CORRECT literal in e2e-bootstrap.ts.
 *
 * Grading semantics that the objective factories rely on (verified against the
 * api grading strategies):
 *  - SINGLE_CORRECT / MULTIPLE_CORRECT: the learner submits an array of choice
 *    *text* strings (`learnerChoices`). The grader normalizes text and matches
 *    it against `choice.choice`, awarding `choice.points` for `isCorrect`
 *    choices. So determinism comes from the choice text + isCorrect/points.
 *  - TRUE_FALSE: the learner submits a boolean (`learnerAnswerChoice`). The
 *    correct answer is derived from `choices[0].choice === "true"`. The single
 *    choice therefore encodes the answer as the literal string "true"/"false".
 *  - TEXT / URL / UPLOAD: graded by a real LLM (NON-deterministic in value).
 *    Use these only to assert "grading loop completed + feedback rendered",
 *    never to assert an exact score. They still need a valid `scoring` rubric.
 */

export type QuestionType =
  | "TEXT"
  | "SINGLE_CORRECT"
  | "MULTIPLE_CORRECT"
  | "TRUE_FALSE"
  | "URL"
  | "UPLOAD"
  | "LINK_FILE";

export type ResponseType =
  | "REPO"
  | "CODE"
  | "ESSAY"
  | "REPORT"
  | "PRESENTATION"
  | "VIDEO"
  | "AUDIO"
  | "IMAGES"
  | "SPREADSHEET"
  | "LIVE_RECORDING"
  | "OTHER";

export type ScoringType = "CRITERIA_BASED" | "LOSS_PER_MISTAKE" | "AI_GRADED";

export type ChoiceInput = {
  id: number;
  choice: string;
  isCorrect: boolean;
  points: number;
  feedback: string;
};

export type RubricCriterionInput = {
  id: number;
  description: string;
  points: number;
};

export type RubricInput = {
  rubricQuestion: string;
  criteria: RubricCriterionInput[];
};

export type ScoringInput = {
  type: ScoringType;
  rubrics: RubricInput[];
  showSubQuestionsToLearner: boolean;
  showPoints: boolean;
  showRubricsToLearner: boolean;
};

/**
 * A single entry of the `questions` array accepted by addContentToAssignment.
 * Kept structurally identical to the api QuestionContentDto so the same object
 * is valid for both seeding and (read-only) assertions.
 */
export type SeedQuestion = {
  type: QuestionType;
  question: string;
  responseType: ResponseType;
  totalPoints: number;
  maxWords: number | null;
  maxCharacters: number | null;
  randomizedChoices: boolean;
  choices?: ChoiceInput[];
  scoring: ScoringInput;
};

const OBJECTIVE_SCORING: ScoringInput = {
  type: "AI_GRADED",
  showSubQuestionsToLearner: false,
  showPoints: true,
  showRubricsToLearner: false,
  rubrics: [],
};

/**
 * Default rubric for open (LLM-graded) question types. The api requires a
 * non-empty `scoring.rubrics` for these; the values do not need to be
 * deterministic because tests never assert the *score* for open types.
 */
function defaultOpenScoring(
  totalPoints: number,
  criterionDescription: string,
): ScoringInput {
  return {
    type: "CRITERIA_BASED",
    showSubQuestionsToLearner: false,
    showPoints: true,
    showRubricsToLearner: true,
    rubrics: [
      {
        rubricQuestion: "Does the response satisfy the requirements?",
        criteria: [
          {
            id: 1,
            description: criterionDescription,
            points: totalPoints,
          },
          {
            id: 2,
            description: "Response is missing or off-topic.",
            points: 0,
          },
        ],
      },
    ],
  };
}

/**
 * SINGLE_CORRECT question. Exactly one choice should be marked correct.
 *
 * @param correctIndex index into `choices` that is the correct answer.
 * The correct choice receives `points`; all others receive 0.
 */
export function singleCorrect(options: {
  prompt: string;
  choices: string[];
  correctIndex: number;
  points?: number;
}): SeedQuestion {
  const { prompt, choices, correctIndex } = options;
  const points = options.points ?? 10;

  if (correctIndex < 0 || correctIndex >= choices.length) {
    throw new Error(
      `singleCorrect: correctIndex ${correctIndex} out of range for ${choices.length} choices.`,
    );
  }

  return {
    type: "SINGLE_CORRECT",
    question: prompt,
    responseType: "OTHER",
    totalPoints: points,
    maxWords: null,
    maxCharacters: null,
    randomizedChoices: false,
    choices: choices.map((choice, index) => ({
      id: index + 1,
      choice,
      isCorrect: index === correctIndex,
      points: index === correctIndex ? points : 0,
      feedback: index === correctIndex ? "Correct!" : "Incorrect.",
    })),
    scoring: OBJECTIVE_SCORING,
  };
}

/**
 * MULTIPLE_CORRECT question. Every index in `correctIndexes` is marked correct
 * and splits `points` evenly so a perfect selection yields `points` total.
 */
export function multipleCorrect(options: {
  prompt: string;
  choices: string[];
  correctIndexes: number[];
  points?: number;
}): SeedQuestion {
  const { prompt, choices, correctIndexes } = options;
  const points = options.points ?? 10;

  if (correctIndexes.length === 0) {
    throw new Error("multipleCorrect: at least one correct index is required.");
  }
  for (const index of correctIndexes) {
    if (index < 0 || index >= choices.length) {
      throw new Error(
        `multipleCorrect: correctIndex ${index} out of range for ${choices.length} choices.`,
      );
    }
  }

  const correctSet = new Set(correctIndexes);
  const perCorrect = Math.round(points / correctIndexes.length);

  return {
    type: "MULTIPLE_CORRECT",
    question: prompt,
    responseType: "OTHER",
    totalPoints: points,
    maxWords: null,
    maxCharacters: null,
    randomizedChoices: false,
    choices: choices.map((choice, index) => ({
      id: index + 1,
      choice,
      isCorrect: correctSet.has(index),
      points: correctSet.has(index) ? perCorrect : 0,
      feedback: correctSet.has(index) ? "Correct!" : "Incorrect.",
    })),
    scoring: OBJECTIVE_SCORING,
  };
}

/**
 * TRUE_FALSE question. The answer is encoded as the single choice's text
 * ("true" / "false"); the learner submits a boolean `learnerAnswerChoice`.
 */
export function trueFalse(options: {
  prompt: string;
  answer: boolean;
  points?: number;
}): SeedQuestion {
  const { prompt, answer } = options;
  const points = options.points ?? 4;

  return {
    type: "TRUE_FALSE",
    question: prompt,
    responseType: "OTHER",
    totalPoints: points,
    maxWords: null,
    maxCharacters: null,
    randomizedChoices: false,
    choices: [
      {
        id: 1,
        choice: answer ? "true" : "false",
        isCorrect: true,
        points,
        feedback: "Correct!",
      },
    ],
    scoring: OBJECTIVE_SCORING,
  };
}

/**
 * TEXT question (open / LLM-graded). Score value is NON-deterministic; assert
 * only that grading completed and feedback rendered.
 */
export function textQuestion(options: {
  prompt: string;
  responseType?: ResponseType;
  points?: number;
  maxWords?: number | null;
  maxCharacters?: number | null;
  rubric?: ScoringInput;
}): SeedQuestion {
  const points = options.points ?? 10;

  return {
    type: "TEXT",
    question: options.prompt,
    responseType: options.responseType ?? "ESSAY",
    totalPoints: points,
    maxWords: options.maxWords ?? 200,
    maxCharacters: options.maxCharacters ?? 1200,
    randomizedChoices: false,
    scoring:
      options.rubric ??
      defaultOpenScoring(points, "Response addresses the prompt accurately."),
  };
}

/**
 * URL question (open / LLM-graded). Score value is NON-deterministic.
 */
export function urlQuestion(options: {
  prompt: string;
  responseType?: ResponseType;
  points?: number;
  rubric?: ScoringInput;
}): SeedQuestion {
  const points = options.points ?? 8;

  return {
    type: "URL",
    question: options.prompt,
    responseType: options.responseType ?? "REPORT",
    totalPoints: points,
    maxWords: null,
    maxCharacters: null,
    randomizedChoices: false,
    scoring:
      options.rubric ??
      defaultOpenScoring(points, "Linked content satisfies the requirements."),
  };
}

/**
 * UPLOAD question (open / LLM-graded). Score value is NON-deterministic.
 */
export function uploadQuestion(options: {
  prompt: string;
  responseType?: ResponseType;
  points?: number;
  rubric?: ScoringInput;
}): SeedQuestion {
  const points = options.points ?? 8;

  return {
    type: "UPLOAD",
    question: options.prompt,
    responseType: options.responseType ?? "CODE",
    totalPoints: points,
    maxWords: null,
    maxCharacters: null,
    randomizedChoices: false,
    scoring:
      options.rubric ??
      defaultOpenScoring(points, "Uploaded file satisfies the requirements."),
  };
}

/**
 * Convenience: the canonical "What is 2 + 2?" objective question used by the
 * default seeded learner assignment, expressed via the factory.
 */
export function defaultMathQuestion(): SeedQuestion {
  return singleCorrect({
    prompt: "What is 2 + 2?",
    choices: ["3", "4", "5"],
    correctIndex: 1,
    points: 10,
  });
}
