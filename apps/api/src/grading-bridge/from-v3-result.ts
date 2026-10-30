import {
  CreateQuestionResponseAttemptResponseDto,
  GeneralFeedbackDto,
  type StructuredCriterion,
} from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import type { GradingQuestion, GradingResult } from "../v3/grading/contracts";
import type { ResolvedMode } from "../v3/grading/mode";

const MAX_NAME = 160;
const MAX_EVIDENCE = 400;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function status(
  points: number,
  maxPoints: number,
): StructuredCriterion["status"] {
  if (points <= 0) return "none";
  return points >= maxPoints ? "full" : "partial";
}

/**
 * v3 result → the legacy per-question response: points, a feedback entry
 * with the structured rubric breakdown, and metadata saying v3 graded it.
 * The attempt commit, success page and LTI passback read only these.
 */
export function toLegacyResponse(
  result: GradingResult,
  question: GradingQuestion,
  mode: ResolvedMode,
  /** Effort credit already included in result.totalPoints. */
  effortBoost = 0,
): CreateQuestionResponseAttemptResponseDto {
  const criteriaById = new Map(
    question.rubric.criteria.map((criterion) => [criterion.id, criterion]),
  );
  const criteria: StructuredCriterion[] = result.verdicts.map((verdict) => {
    const criterion = criteriaById.get(verdict.criterionId);
    const maxPoints = criterion?.maxPoints ?? 0;
    return {
      name: clip(criterion?.description ?? verdict.criterionId, MAX_NAME),
      pointsAwarded: verdict.points,
      maxPoints,
      status: status(verdict.points, maxPoints),
      evidence: clip(
        verdict.quotes
          .map((quote) => `"${quote.text}" (${quote.part})`)
          .join("; "),
        MAX_EVIDENCE,
      ),
      feedback: verdict.feedback,
    };
  });

  const lines = criteria.map(
    (criterion) =>
      `**${criterion.name}** (${criterion.pointsAwarded}/${criterion.maxPoints}): ${criterion.feedback}`,
  );
  const boostNote =
    effortBoost > 0
      ? `Effort credit: +${effortBoost} point${effortBoost === 1 ? "" : "s"} for a genuine attempt at this question.`
      : "";
  const feedback = new GeneralFeedbackDto();
  feedback.feedback = [result.overallFeedback, ...lines, boostNote]
    .filter((line) => line.trim().length > 0)
    .join("\n\n");
  feedback.structuredFeedback = {
    summary: result.overallFeedback,
    criteria,
    guidance: boostNote,
  };

  const responseDto = new CreateQuestionResponseAttemptResponseDto();
  responseDto.totalPoints = Math.max(
    0,
    Math.min(result.totalPoints, question.totalPoints),
  );
  responseDto.feedback = [feedback];
  responseDto.metadata = {
    strategyUsed: "V3Grading",
    gradingEngine: "v3",
    model: result.model,
    effort: result.effort,
    promptVersion: result.promptVersion,
    usage: result.usage,
    modeSource: mode.source,
    modeConfigId: mode.configId,
    checkFailures: result.checkFailures.map((failure) => ({
      code: failure.code,
      criterionId: failure.criterionId,
    })),
    maxPossiblePoints: question.totalPoints,
    solidAttempt: result.solidAttempt,
    effortBoost,
  };
  return responseDto;
}
