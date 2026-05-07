import { BadRequestException } from "@nestjs/common";
import { EnhancedQuestionsToGenerate } from "../dto/post.assignment.request.dto";
import {
  assertQuestionCountsWithinCaps,
  QUESTION_COUNT_PER_FIELD_MAX,
  QUESTION_COUNT_PER_SUBTYPE_MAX,
  QUESTION_COUNT_TOTAL_MAX,
} from "./questions-to-generate-caps.util";

const baseCounts = (): EnhancedQuestionsToGenerate => ({
  multipleChoice: 0,
  multipleSelect: 0,
  textResponse: 0,
  trueFalse: 0,
  url: 0,
  upload: 0,
  linkFile: 0,
});

describe("assertQuestionCountsWithinCaps", () => {
  it("accepts an all-zero payload", () => {
    expect(() => assertQuestionCountsWithinCaps(baseCounts())).not.toThrow();
  });

  it("accepts regular fields at the per-field cap", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoice: QUESTION_COUNT_PER_FIELD_MAX,
      }),
    ).not.toThrow();
  });

  it("rejects a regular field above the per-field cap", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoice: QUESTION_COUNT_PER_FIELD_MAX + 1,
      }),
    ).toThrow(BadRequestException);
  });

  it("rejects a negative count", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        textResponse: -1,
      }),
    ).toThrow(/non-negative integer/);
  });

  it("rejects a non-integer count", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        trueFalse: 2.5,
      }),
    ).toThrow(/non-negative integer/);
  });

  it("accepts a subtype count at the per-subtype cap", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoiceSubtypes: { short: QUESTION_COUNT_PER_SUBTYPE_MAX },
      }),
    ).not.toThrow();
  });

  it("rejects a subtype count above the per-subtype cap", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoiceSubtypes: { short: QUESTION_COUNT_PER_SUBTYPE_MAX + 1 },
      }),
    ).toThrow(/multipleChoiceSubtypes\.short/);
  });

  it("enforces the subtype cap tighter than the regular-field cap", () => {
    // A value between the subtype cap and the regular cap is only valid on a regular field.
    const between = QUESTION_COUNT_PER_SUBTYPE_MAX + 1;
    expect(between).toBeLessThanOrEqual(QUESTION_COUNT_PER_FIELD_MAX);
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoice: between,
      }),
    ).not.toThrow();
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoiceSubtypes: { long: between },
      }),
    ).toThrow(BadRequestException);
  });

  it("rejects when the sum exceeds the total cap even if each field is within its per-field cap", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoice: 100,
        multipleSelect: 100,
        textResponse: 100,
        trueFalse: 1,
      }),
    ).toThrow(/Total question count/);
  });

  it("accepts a total equal to the total cap", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoice: 100,
        multipleSelect: 100,
        textResponse: 100,
      }),
    ).not.toThrow();
    expect(QUESTION_COUNT_TOTAL_MAX).toBe(300);
  });

  it("ignores missing optional subtype fields", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoiceSubtypes: { scenario: 3 },
      }),
    ).not.toThrow();
  });

  it("coerces string numerics and validates them against the regular-field cap", () => {
    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoice: "5" as unknown as number,
      }),
    ).not.toThrow();

    expect(() =>
      assertQuestionCountsWithinCaps({
        ...baseCounts(),
        multipleChoice: "101" as unknown as number,
      }),
    ).toThrow(BadRequestException);
  });
});
