import { z } from "zod";
import {
  applyEvidenceChecks,
  describeFailuresForRetry,
  structuralFailures,
} from "./checks";
import {
  addUsage,
  type CheckFailure,
  type GradingDebug,
  gradingInputSchema,
  type GradingEffort,
  type GradingFailure,
  type GradingFailureCode,
  type GradingInput,
  type GradingLogger,
  type GradingOutcome,
  type GradingQuestion,
  type GradingUsage,
  type ModelGradeOutput,
  modelGradeOutputSchema,
  ZERO_USAGE,
} from "./contracts";
import {
  COST_CEILING_USD,
  estimateCallCostUsd,
  estimateCostUsd,
  MAX_OUTPUT_TOKENS,
} from "./limits";
import {
  DEFAULT_MATERIALIZE_LIMITS,
  estimatePartTokens,
  estimatePartsTokens,
  materialize,
  type MaterializeDeps,
  type MaterializeLimits,
  type SubmissionSource,
} from "./materialize";
import {
  type GradingModelClient,
  GradingModelUnavailableError,
  type PromptMessage,
} from "./model-client";
import {
  buildGradePrompt,
  buildRetryMessages,
  PROMPT_VERSION,
} from "./prompts/grade.v2";

/** Ids for logs only; never learner content. */
export interface GradingLogContext {
  questionId?: number;
  assignmentId?: number;
  attemptId?: number;
  mode?: string;
  questionType?: string;
}

export interface GradeDeps {
  client: GradingModelClient;
  logger: GradingLogger;
  context?: GradingLogContext;
  tokenBudget?: number;
  /** Per-question ceiling on estimated spend; over it, no model call. */
  costCeilingUsd?: number;
  now?: () => number;
  /**
   * Spike/admin only: request the model's reasoning summary and return a
   * debug block (parts sent, raw output, per-quote checks). Never logged;
   * learner grading never sets it.
   */
  debug?: boolean;
}

const OUTPUT_SCHEMA_NAME = "rubric_grade";

function outputJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(modelGradeOutputSchema, {
    target: "draft-7",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

const OUTPUT_JSON_SCHEMA = outputJsonSchema();

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseModelOutput(
  text: string,
): { ok: true; output: ModelGradeOutput } | { ok: false; detail: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, detail: "output was not valid JSON" };
  }
  const parsed = modelGradeOutputSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, detail: "output did not match the schema" };
  }
  return { ok: true, output: parsed.data };
}

/**
 * Grade one question whose submission is already materialized. Pure: no
 * Nest, no database. One model call, checks, at most one retry when the
 * verdicts are structurally wrong, then a result or a failure.
 */
export async function gradeWithV3(
  input: GradingInput,
  deps: GradeDeps,
): Promise<GradingOutcome> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const context = deps.context ?? {};
  const effort: GradingEffort = input.effort;
  let usage: GradingUsage = ZERO_USAGE;
  let model: string | undefined;
  const reasoningSummary: string[] = [];
  const rawOutputs: string[] = [];
  const debugBlock = (
    quoteChecks: GradingDebug["quoteChecks"],
  ): { debug?: GradingDebug } =>
    deps.debug
      ? {
          debug: {
            reasoningSummary: [...reasoningSummary],
            parts: input.parts.map((part) => ({
              name: part.name,
              kind: part.kind,
              ...(part.mimeType ? { mimeType: part.mimeType } : {}),
              estimatedTokens: estimatePartTokens(part),
            })),
            rawOutputs: [...rawOutputs],
            quoteChecks,
          },
        }
      : {};

  const fail = (
    code: GradingFailureCode,
    message: string,
    extra: Partial<GradingFailure> = {},
  ): GradingOutcome => {
    const failure: GradingFailure = {
      code,
      message,
      retryable: false,
      checkFailures: [],
      usage,
      model,
      effort,
      promptVersion: PROMPT_VERSION,
      ...debugBlock([]),
      ...extra,
    };
    deps.logger.warn("grading.v3.failed", {
      ...context,
      code,
      reason: message,
      effort,
      model,
      usage,
      retryable: failure.retryable,
      checkFailures: failure.checkFailures.map((item) => ({
        code: item.code,
        criterionId: item.criterionId,
      })),
      durationMs: now() - started,
    });
    return { status: "failed", failure };
  };

  const validated = gradingInputSchema.safeParse(input);
  if (!validated.success) {
    return fail("grading.v3.invalid_input", "grading input failed validation");
  }
  const criteria = input.rubric.criteria;

  const tokenBudget =
    deps.tokenBudget ?? DEFAULT_MATERIALIZE_LIMITS.tokenBudget;
  const estimatedTokens = estimatePartsTokens(input.parts);
  if (estimatedTokens > tokenBudget) {
    return fail(
      "grading.v3.over_budget",
      `submission is about ${estimatedTokens} tokens, over the ${tokenBudget} token budget`,
      { estimatedTokens, tokenBudget },
    );
  }

  deps.logger.info("grading.v3.start", {
    ...context,
    effort,
    promptVersion: PROMPT_VERSION,
    partCount: input.parts.length,
    partKinds: input.parts.map((part) => part.kind),
    criteriaCount: criteria.length,
    estimatedTokens,
    estimatedCostUsd: estimateCallCostUsd(estimatedTokens),
  });

  let messages: PromptMessage[] = buildGradePrompt(input);
  let lastFailures: CheckFailure[] = [];
  const costCeiling = deps.costCeilingUsd ?? COST_CEILING_USD;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // Projected spend: what earlier calls cost plus a worst-case next call.
    const callTokens =
      attempt === 1 ? estimatedTokens : estimatedTokens + MAX_OUTPUT_TOKENS;
    const projectedCostUsd =
      estimateCostUsd(usage) + estimateCallCostUsd(callTokens);
    if (projectedCostUsd > costCeiling) {
      return fail(
        "grading.v3.over_budget",
        `estimated cost $${projectedCostUsd.toFixed(4)} is over the $${costCeiling} per-question ceiling`,
        { estimatedTokens, tokenBudget },
      );
    }
    let outputText: string;
    try {
      const response = await deps.client.complete({
        messages,
        effort,
        schemaName: OUTPUT_SCHEMA_NAME,
        jsonSchema: OUTPUT_JSON_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(deps.debug ? { reasoningSummary: true } : {}),
      });
      usage = addUsage(usage, response.usage);
      model = response.model;
      outputText = response.outputText;
      if (deps.debug) {
        rawOutputs.push(outputText);
        reasoningSummary.push(...(response.reasoningSummary ?? []));
      }
    } catch (error) {
      deps.logger.error("grading.v3.model_call_failed", {
        ...context,
        attempt,
        effort,
        errorClass: error instanceof Error ? error.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (error instanceof GradingModelUnavailableError) {
        return fail("grading.v3.model_unavailable", error.message, {
          retryable: true,
        });
      }
      return fail(
        "grading.v3.model_error",
        error instanceof Error ? error.message : "model call failed",
      );
    }

    const parsed = parseModelOutput(outputText);
    const structural = parsed.ok
      ? structuralFailures(parsed.output, criteria)
      : [];
    if (parsed.ok && structural.length === 0) {
      const checked = applyEvidenceChecks(parsed.output, criteria, input.parts);
      const rubricMax = criteria.reduce((sum, item) => sum + item.maxPoints, 0);
      const awarded = checked.verdicts.reduce(
        (sum, item) => sum + item.points,
        0,
      );
      // Rubric maxima may not add up to the question's points; scale to them.
      const totalPoints =
        rubricMax > 0 && rubricMax !== input.totalPoints
          ? round2((awarded / rubricMax) * input.totalPoints)
          : round2(awarded);
      const checkFailures = [...lastFailures, ...checked.failures];
      deps.logger.info("grading.v3.graded", {
        ...context,
        effort,
        model,
        promptVersion: PROMPT_VERSION,
        usage,
        costUsd: estimateCostUsd(usage),
        attempts: attempt,
        totalPoints,
        maxPoints: input.totalPoints,
        checkFailures: checkFailures.map((item) => ({
          code: item.code,
          criterionId: item.criterionId,
        })),
        durationMs: now() - started,
      });
      return {
        status: "graded",
        result: {
          verdicts: checked.verdicts,
          totalPoints,
          overallFeedback: parsed.output.overallFeedback,
          usage,
          model: model ?? "unknown",
          effort,
          promptVersion: PROMPT_VERSION,
          checkFailures,
          ...debugBlock(checked.quoteChecks),
        },
      };
    }

    lastFailures =
      parsed.ok === false
        ? [{ code: "missing_verdict", detail: parsed.detail }]
        : structural;
    deps.logger.warn("grading.v3.check_failed", {
      ...context,
      attempt,
      willRetry: attempt === 1,
      checkFailures: lastFailures.map((item) => ({
        code: item.code,
        criterionId: item.criterionId,
      })),
    });
    messages = [
      ...messages,
      ...buildRetryMessages(outputText, describeFailuresForRetry(lastFailures)),
    ];
  }

  return fail(
    "grading.v3.check_failed",
    "model output failed the checks twice",
    { checkFailures: lastFailures },
  );
}

export interface SubmissionGradeDeps extends GradeDeps {
  materializeDeps?: MaterializeDeps;
  limits?: MaterializeLimits;
}

/**
 * Materialize the submission, check its size, grade it. Over-limit
 * submissions fail clearly; nothing is truncated.
 */
export async function gradeSubmission(
  question: GradingQuestion,
  source: SubmissionSource,
  deps: SubmissionGradeDeps,
): Promise<GradingOutcome> {
  const limits = deps.limits ?? DEFAULT_MATERIALIZE_LIMITS;
  const materialized = await materialize(
    {
      ...source,
      questionContext:
        source.questionContext ??
        [
          question.questionText,
          ...question.rubric.criteria.map((criterion) => criterion.description),
        ].join("\n"),
    },
    deps.materializeDeps ?? {},
    limits,
  );
  if (materialized.ok === false) {
    deps.logger.warn("grading.v3.materialize_failed", {
      ...deps.context,
      code: materialized.code,
      partName: materialized.partName,
      estimatedTokens: materialized.estimatedTokens,
    });
    return {
      status: "failed",
      failure: {
        code: "grading.v3.over_budget",
        message: materialized.message,
        retryable: false,
        checkFailures: [],
        usage: ZERO_USAGE,
        model: undefined,
        effort: question.effort,
        promptVersion: PROMPT_VERSION,
        estimatedTokens: materialized.estimatedTokens,
        tokenBudget: limits.tokenBudget,
      },
    };
  }
  deps.logger.info("grading.v3.materialized", {
    ...deps.context,
    ...materialized.stats,
    partCount: materialized.parts.length,
    totalBytes: materialized.totalBytes,
  });
  return gradeWithV3(
    { ...question, parts: materialized.parts },
    { ...deps, tokenBudget: limits.tokenBudget },
  );
}
