import { BadRequestException } from "@nestjs/common";
import { EnhancedQuestionsToGenerate } from "../dto/post.assignment.request.dto";

export const QUESTION_COUNT_PER_FIELD_MAX = 100;
export const QUESTION_COUNT_PER_SUBTYPE_MAX = 50;
export const QUESTION_COUNT_TOTAL_MAX = 300;

type FieldEntry = readonly [label: string, rawValue: unknown, max: number];

function coerceCount(rawValue: unknown): number {
  const coerced = Number(rawValue);
  return Number.isFinite(coerced) ? coerced : 0;
}

export function assertQuestionCountsWithinCaps(
  questionsToGenerate: EnhancedQuestionsToGenerate,
): void {
  const fields: FieldEntry[] = [
    [
      "multipleChoice",
      questionsToGenerate.multipleChoice,
      QUESTION_COUNT_PER_FIELD_MAX,
    ],
    [
      "multipleSelect",
      questionsToGenerate.multipleSelect,
      QUESTION_COUNT_PER_FIELD_MAX,
    ],
    [
      "textResponse",
      questionsToGenerate.textResponse,
      QUESTION_COUNT_PER_FIELD_MAX,
    ],
    ["trueFalse", questionsToGenerate.trueFalse, QUESTION_COUNT_PER_FIELD_MAX],
    ["url", questionsToGenerate.url, QUESTION_COUNT_PER_FIELD_MAX],
    ["upload", questionsToGenerate.upload, QUESTION_COUNT_PER_FIELD_MAX],
    ["linkFile", questionsToGenerate.linkFile, QUESTION_COUNT_PER_FIELD_MAX],
  ];

  const subtypes = questionsToGenerate.multipleChoiceSubtypes;
  if (subtypes) {
    fields.push(
      [
        "multipleChoiceSubtypes.short",
        subtypes.short,
        QUESTION_COUNT_PER_SUBTYPE_MAX,
      ],
      [
        "multipleChoiceSubtypes.quantitative",
        subtypes.quantitative,
        QUESTION_COUNT_PER_SUBTYPE_MAX,
      ],
      [
        "multipleChoiceSubtypes.long",
        subtypes.long,
        QUESTION_COUNT_PER_SUBTYPE_MAX,
      ],
      [
        "multipleChoiceSubtypes.scenario",
        subtypes.scenario,
        QUESTION_COUNT_PER_SUBTYPE_MAX,
      ],
    );
  }

  let total = 0;
  for (const [label, rawValue, max] of fields) {
    const value = coerceCount(rawValue);
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${label} must be a non-negative integer`);
    }
    if (value > max) {
      throw new BadRequestException(`${label} must be ${max} or less`);
    }
    total += value;
  }

  if (total > QUESTION_COUNT_TOTAL_MAX) {
    throw new BadRequestException(
      `Total question count (${total}) exceeds the limit of ${QUESTION_COUNT_TOTAL_MAX}`,
    );
  }
}
