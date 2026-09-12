import { Logger } from "@nestjs/common";
import { UpdateAssignmentQuestionsDto } from "src/api/assignment/dto/update.questions.request.dto";
import {
  AssignmentAttemptWithRelations,
  AttemptQuestionsMapper,
  TranslatedContent,
} from "./attempt-questions-mapper.util";

const QUESTION_HTML =
  '<p>Pick the <strong>best</strong> option.</p><ol><li data-list="bullet">first</li><li data-list="bullet">second</li></ol>';

const BASE_CHOICES = [
  { id: 11, choice: "<strong>Alpha</strong>", isCorrect: true, points: 1 },
  { id: 12, choice: "Beta", isCorrect: false, points: 0 },
];

const buildAssignment = (): UpdateAssignmentQuestionsDto =>
  ({
    id: 500,
    questionOrder: [42],
    questions: [
      {
        id: 42,
        question: QUESTION_HTML,
        choices: BASE_CHOICES,
        totalPoints: 1,
        type: "SINGLE_CORRECT",
        assignmentId: 500,
        gradingContextQuestionIds: [],
        responseType: null,
        isDeleted: false,
        maxWords: null,
        maxCharacters: null,
        scoring: null,
        answer: null,
        videoPresentationConfig: null,
        liveRecordingConfig: null,
      },
    ],
  }) as unknown as UpdateAssignmentQuestionsDto;

/**
 * Mirrors the shape the attempt service passes in: `questionVariant` is always
 * an object (it is spread from a possibly-null relation), so a plain question
 * still takes the variant branch of the mapper.
 */
const buildAttempt = (
  randomizedChoices: string | null,
  variant?: Record<string, unknown>,
): AssignmentAttemptWithRelations =>
  ({
    id: 9001,
    assignmentId: 500,
    questionOrder: [42],
    questionResponses: [],
    questionVariants: [
      {
        questionId: 42,
        randomizedChoices,
        questionVariant: variant ?? {},
      },
    ],
  }) as unknown as AssignmentAttemptWithRelations;

const buildTranslations = (
  entries: Record<string, Record<string, TranslatedContent>> = {},
): Map<string, Record<string, TranslatedContent>> =>
  new Map<string, Record<string, TranslatedContent>>(Object.entries(entries));

describe("AttemptQuestionsMapper.buildQuestionsWithTranslations", () => {
  it("serves the untranslated question when the language has no translation and choices are randomized", async () => {
    const questions =
      await AttemptQuestionsMapper.buildQuestionsWithTranslations(
        buildAttempt(JSON.stringify([{ id: 12 }, { id: 11 }])),
        buildAssignment(),
        buildTranslations({
          "question-42": {
            en: {
              translatedText: QUESTION_HTML,
              translatedChoices: BASE_CHOICES,
            },
          },
        }),
        "de",
      );

    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe(QUESTION_HTML);
    expect(questions[0].choices).toEqual([
      { id: 12, choice: "Beta" },
      { id: 11, choice: "<strong>Alpha</strong>" },
    ]);
  });

  it("serves the untranslated question when the language has no translation and choices are not randomized", async () => {
    const questions =
      await AttemptQuestionsMapper.buildQuestionsWithTranslations(
        buildAttempt(null),
        buildAssignment(),
        buildTranslations({ "question-42": {} }),
        "vi",
      );

    expect(questions[0].question).toBe(QUESTION_HTML);
    expect(questions[0].choices).toEqual([
      { id: 11, choice: "<strong>Alpha</strong>" },
      { id: 12, choice: "Beta" },
    ]);
  });

  it("falls back to the variant content when neither the variant nor the question is translated", async () => {
    const questions =
      await AttemptQuestionsMapper.buildQuestionsWithTranslations(
        buildAttempt(null, {
          id: 77,
          variantContent: "<p>Variant body</p>",
          choices: [{ id: 21, choice: "Gamma" }],
        }),
        buildAssignment(),
        buildTranslations({ "question-42": {} }),
        "ja",
      );

    expect(questions[0].question).toBe("<p>Variant body</p>");
    expect(questions[0].choices).toEqual([{ id: 21, choice: "Gamma" }]);
  });

  it("logs a warning naming the question and the language when it falls back", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();

    await AttemptQuestionsMapper.buildQuestionsWithTranslations(
      buildAttempt(null),
      buildAssignment(),
      buildTranslations({ "question-42": {} }),
      "pt",
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("42");
    expect(message).toContain("pt");
  });

  it("still uses the translation when the language has one", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();

    const questions =
      await AttemptQuestionsMapper.buildQuestionsWithTranslations(
        buildAttempt(null),
        buildAssignment(),
        buildTranslations({
          "question-42": {
            es: {
              translatedText: "<p>Elige la <strong>mejor</strong> opción.</p>",
              translatedChoices: [
                { id: 11, choice: "<strong>Alfa</strong>" },
                { id: 12, choice: "Beta" },
              ],
            },
          },
        }),
        "es",
      );

    expect(questions[0].question).toBe(
      "<p>Elige la <strong>mejor</strong> opción.</p>",
    );
    expect(questions[0].choices).toEqual([
      { id: 11, choice: "<strong>Alfa</strong>" },
      { id: 12, choice: "Beta" },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("serves stored markup unchanged so the learner payload keeps its formatting", async () => {
    const translatedHtml =
      '<p>Párrafo uno.</p><ol><li data-list="bullet">uno</li></ol>';

    const questions =
      await AttemptQuestionsMapper.buildQuestionsWithTranslations(
        buildAttempt(null),
        buildAssignment(),
        buildTranslations({
          "question-42": {
            es: {
              translatedText: translatedHtml,
              translatedChoices: BASE_CHOICES,
            },
          },
        }),
        "es",
      );

    expect(questions[0].question).toBe(translatedHtml);
  });
});
