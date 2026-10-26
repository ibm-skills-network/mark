import { Logger } from "@nestjs/common";
import { QuestionType, QuestionVersion } from "@prisma/client";
import {
  applyVariantToQuestion,
  isVersionOnlyQuestion,
  questionDtoFromVersion,
} from "./grading-question-source.util";

const versionRow = (
  overrides: Partial<QuestionVersion> = {},
): QuestionVersion => ({
  id: 5001,
  assignmentVersionId: 9,
  authorComment: null,
  questionId: 101,
  totalPoints: 5,
  type: QuestionType.SINGLE_CORRECT,
  responseType: null,
  question: "Pick one",
  maxWords: null,
  scoring: null,
  choices: [{ choice: "A", isCorrect: true, points: 5 }],
  randomizedChoices: null,
  answer: null,
  gradingContextQuestionIds: [],
  maxCharacters: null,
  videoPresentationConfig: null,
  liveRecordingConfig: null,
  displayOrder: null,
  createdAt: new Date(0),
  ...overrides,
});

describe("grading question source", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it("keys a version row by its source question id", () => {
    const dto = questionDtoFromVersion(versionRow(), 99);

    expect(dto.id).toBe(101);
    expect(isVersionOnlyQuestion(dto)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("marks a row with no source question and warns", () => {
    const dto = questionDtoFromVersion(versionRow({ questionId: null }), 99);

    expect(dto.id).toBe(5001);
    expect(isVersionOnlyQuestion(dto)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "grading.question_source.version_without_question",
      expect.objectContaining({ questionVersionId: 5001, assignmentId: 99 }),
    );
  });

  it("keeps the mark through a drawn variant", () => {
    const dto = questionDtoFromVersion(versionRow({ questionId: null }), 99);
    const withVariant = applyVariantToQuestion(dto, {
      id: 7,
      variantContent: "Variant wording",
      maxWords: null,
      maxCharacters: null,
      scoring: null,
      choices: null,
      answer: null,
    });

    expect(isVersionOnlyQuestion(withVariant)).toBe(true);
    // The mark is never serialized.
    expect(JSON.stringify(withVariant)).not.toContain("versionOnly");
  });

  it("warns with the question and version ids when stored JSON is corrupt", () => {
    const dto = questionDtoFromVersion(
      versionRow({ choices: "{not json" }),
      99,
    );

    expect(dto.choices).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "grading.question_source.corrupt_json",
      expect.objectContaining({
        field: "choices",
        questionId: 101,
        questionVersionId: 5001,
      }),
    );
  });

  it("warns with the variant id when a variant's JSON is corrupt", () => {
    const base = questionDtoFromVersion(versionRow(), 99);
    const withVariant = applyVariantToQuestion(base, {
      id: 7,
      variantContent: "Variant wording",
      maxWords: null,
      maxCharacters: null,
      scoring: "oops",
      choices: null,
      answer: null,
    });

    expect(withVariant.scoring).toBe(base.scoring);
    expect(warn).toHaveBeenCalledWith(
      "grading.question_source.corrupt_json",
      expect.objectContaining({
        field: "scoring",
        questionId: 101,
        variantId: 7,
      }),
    );
  });
});
