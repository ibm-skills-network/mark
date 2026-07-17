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
import type { LlmCallRecorder } from "./criterion-evidence-retrieval.service";

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

    const prompt = new PromptTemplate({
      template: `You are a grading judge. Review rubric criteria, grader outputs, and evidence citations.

QUESTION:
{question}

RUBRIC:
{rubric}

CRITERION OUTPUTS:
{outputs}

EVIDENCE SUMMARY:
{evidence}

CHECKS:
- Evidence quality (anchored, relevant, not hallucinated).
- Rationale consistency with evidence and rubric.
- Score alignment with rubric points.

Return issues per criterionId if any.

{format_instructions}`,
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
              const citations = item.evidence
                .map((event) => `${event.chunkId}: ${event.quote}`)
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
        getDeterministicGradingOptions(selectedModel),
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
