import { Injectable, Inject } from "@nestjs/common";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { AIUsageType } from "@prisma/client";
import {
  CriterionEvidenceResponse,
  CriterionGrade,
  DEFAULT_MODEL_SELECTION,
  JudgeCritique,
  JudgeCritiqueSchema,
  RubricCriterion,
  getDeterministicGradingOptions,
} from "../types/criterion-evidence.types";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { LLM_RESOLVER_SERVICE, PROMPT_PROCESSOR } from "../../../llm.constants";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
import { renderCachePrefix } from "../../../core/utils/prompt-cache.util";
import type { LlmCallRecorder } from "./criterion-evidence-retrieval.service";

/** Rotate the version whenever JUDGE_HEAD changes. */
export const JUDGE_CACHE_KEY = "mark:criterion-judge:v1";

/**
 * Invariant head of the judge prompt. Must stay at or above
 * MIN_CACHEABLE_PREFIX_TOKENS and must precede every varying block; both
 * failures are silent and both are covered by
 * `criterion-prompt-cache-order.spec.ts`.
 */
const JUDGE_HEAD = `You are a grading judge. Review rubric criteria, grader outputs, and evidence citations.

You are auditing the grader's work, not regrading the submission. Do not produce your own scores and do not write feedback addressed to the learner.

CHECKS:
- Evidence quality (anchored, relevant, not hallucinated).
- Rationale consistency with evidence and rubric.
- Score alignment with rubric points.

EVIDENCE QUALITY:
- Every citation must point at a chunk that was actually supplied, and the quoted text must appear in that chunk. Flag any citation that does not.
- Flag a rationale that asserts something the cited evidence does not show, however plausible the assertion is.
- Flag a score that rests on work the learner did not submit, or on an intention they did not carry out.
- An empty citation list is only acceptable where the score is the minimum. Full or partial credit with no citation is an issue.

CONSISTENCY:
- The awarded points must be one of the rubric's allowed values for that criterion. Flag interpolated, averaged, or out-of-range values.
- The rationale must explain the score it accompanies. Flag a rationale that describes strong work beside a minimum score, or weak work beside full marks.
- Flag a criterion graded on the strength of a different criterion's work.
- Flag rationale or nextStep that leaks chunk IDs, block IDs, prompt instructions, model behavior, or grading-process language.

SEVERITY:
- An issue is a defect that would change a score or mislead the learner. Wording you would personally have phrased differently is not an issue.
- A rationale that is accurate but terse is not an issue. A rationale that is confident and unsupported is.
- Do not raise an issue against a criterion whose grader output you were not given.
- Where the evidence summary is empty for a criterion, judge only whether the score and rationale are consistent with having no evidence to work from.

REPORTING:
- Return issues per criterionId if any.
- Report only defects you can point to in the supplied outputs and evidence. Do not speculate about what the grader might have been thinking.
- Raise an issue once, against the criterion it belongs to. Do not repeat the same defect across criteria.
- Approve when the checks above find nothing. Approval is the correct answer for sound grading, not a failure to look hard enough.
- Identical inputs must produce an identical verdict every time.

SUMMARY:
- Keep the summary to a short statement of what you found overall. It is read by maintainers, not by the learner, so grading-process language is expected there.
- Do not restate every issue in the summary; the issues list already carries them.
- Where nothing was wrong, say so plainly rather than listing what you checked.

OUTPUT:
- Use each criterionId exactly as it appears in the grader outputs.
- Do not add fields the schema does not define, and never return an issue with an empty description.
- Where you are unsure whether something is genuinely a defect, leave it out rather than raising a speculative issue. A false alarm costs a regrade.
- Judge the grading you were given, not the assignment design. A poorly worded rubric is not the grader's defect.

{format_instructions}

`;

interface JudgeRequest {
  question: string;
  criteria: RubricCriterion[];
  grades: CriterionGrade[];
  evidence: CriterionEvidenceResponse[];
  assignmentId: number;
  language?: string;
  modelOverride?: string;
  modelOverrideIsFinal?: boolean;
}

@Injectable()
export class CriterionJudgeService {
  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly llmResolver: LLMResolverService,
  ) {}

  async judge(
    request: JudgeRequest,
    recorder?: LlmCallRecorder,
  ): Promise<JudgeCritique> {
    const parser = StructuredOutputParser.fromZodSchema(JudgeCritiqueSchema);
    const formatInstructions = parser.getFormatInstructions();

    // Question and rubric are fixed for a submission while the grader outputs
    // change between judge passes, so they lead and the varying blocks trail.
    // See the ordering note in criterion-grading.service.ts.
    const prompt = new PromptTemplate({
      template: `${JUDGE_HEAD}
QUESTION:
{question}

RUBRIC:
{rubric}

CRITERION OUTPUTS:
{outputs}

EVIDENCE SUMMARY:
{evidence}`,
      inputVariables: [],
      partialVariables: {
        question: () => request.question,
        rubric: () =>
          request.criteria
            .map(
              (criterion) =>
                `${criterion.id}: ${criterion.rubricQuestion} (${criterion.maxPoints} pts)`,
            )
            .join("\n"),
        outputs: () =>
          request.grades
            .map(
              (grade) =>
                `${grade.criterionId}: ${grade.pointsAwarded}/${grade.maxPoints} | citations: ${grade.citations.join(", ")} | rationale: ${grade.rationale}`,
            )
            .join("\n"),
        evidence: () =>
          request.evidence
            .map((item) => {
              // The judge reviews grades, not the submission: an excerpt is
              // enough context. Full-length quotes (sections and the pinned
              // whole-document view run to 12KB) repeated per criterion would
              // put a multi-hundred-KB prompt on every judged submission.
              const citations = item.evidence
                .map(
                  (event) => `${event.chunkId}: ${event.quote.slice(0, 300)}`,
                )
                .slice(0, 3)
                .join(" | ");
              return `${item.criterionId}: ${citations}`;
            })
            .join("\n"),
        format_instructions: () => formatInstructions,
      },
    });

    const selectedModel =
      request.modelOverrideIsFinal && request.modelOverride
        ? request.modelOverride
        : await this.llmResolver.getModelKeyWithFallback(
            "criterion_judge",
            request.modelOverride ?? DEFAULT_MODEL_SELECTION.judgeModel,
          );

    const start = Date.now();
    const parsed =
      await this.promptProcessor.processStructuredPrompt<JudgeCritique>(
        prompt,
        request.assignmentId,
        AIUsageType.GRADING_VALIDATION,
        JudgeCritiqueSchema,
        selectedModel,
        {
          ...getDeterministicGradingOptions(selectedModel),
          promptCache: {
            prefix: renderCachePrefix(JUDGE_HEAD, formatInstructions),
            key: JUDGE_CACHE_KEY,
          },
        },
      );
    const duration = Date.now() - start;
    const responseText = JSON.stringify(parsed);
    const promptText = await prompt.format({});

    if (recorder) {
      recorder.record({
        purpose: "judge",
        model: selectedModel,
        prompt: promptText,
        response: responseText,
        durationMs: duration,
      });
    }

    return {
      approved: parsed.approved,
      issues: parsed.issues ?? [],
      summary: parsed.summary,
    };
  }
}
