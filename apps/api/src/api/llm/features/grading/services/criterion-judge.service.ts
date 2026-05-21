import { Injectable, Inject, Logger } from "@nestjs/common";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { AIUsageType } from "@prisma/client";
import {
  CriterionEvidenceResponse,
  CriterionGrade,
  JudgeCritique,
  JudgeCritiqueSchema,
  RubricCriterion,
} from "../types/criterion-evidence.types";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { LLM_RESOLVER_SERVICE, PROMPT_PROCESSOR } from "../../../llm.constants";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
import { extractStructuredJSON } from "../../../core/utils/structured-json.util";
import type { LlmCallRecorder } from "./criterion-evidence-retrieval.service";

interface JudgeRequest {
  question: string;
  criteria: RubricCriterion[];
  grades: CriterionGrade[];
  evidence: CriterionEvidenceResponse[];
  assignmentId: number;
  language?: string;
  modelOverride?: string;
}

@Injectable()
export class CriterionJudgeService {
  private readonly logger = new Logger(CriterionJudgeService.name);

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
      request.modelOverride ||
      (await this.llmResolver.getModelForValidationTask(
        "criterion_judge",
        request.question.length + request.grades.length * 120,
      ));

    const start = Date.now();
    const response = await this.promptProcessor.processPromptForFeature(
      prompt,
      request.assignmentId,
      AIUsageType.GRADING_VALIDATION,
      "criterion_judge",
      selectedModel,
    );
    const duration = Date.now() - start;
    const responseText =
      typeof response === "string" ? response : String(response);
    const promptText =
      typeof prompt.template === "string"
        ? prompt.template
        : String(prompt.template);

    if (recorder) {
      recorder.record({
        purpose: "judge",
        model: selectedModel,
        prompt: promptText,
        response: responseText,
        durationMs: duration,
      });
    }

    try {
      const parsed = (await parser.parse(responseText)) as JudgeCritique;
      return {
        approved: parsed.approved,
        issues: parsed.issues ?? [],
        summary: parsed.summary,
      };
    } catch {
      const extracted = extractStructuredJSON(responseText);
      if (extracted === responseText) {
        this.logger.warn(
          `Failed to parse judge output for assignment ${request.assignmentId}`,
        );
      } else {
        try {
          const parsed = (await parser.parse(extracted)) as JudgeCritique;
          return {
            approved: parsed.approved,
            issues: parsed.issues ?? [],
            summary: parsed.summary,
          };
        } catch {
          this.logger.warn(
            `Failed to parse judge output for assignment ${request.assignmentId}`,
          );
        }
      }

      return {
        approved: false,
        issues: request.grades.map((grade) => ({
          criterionId: grade.criterionId,
          severity: "medium",
          issue: "Judge response could not be parsed",
        })),
        summary: "Judge parse failure",
      };
    }
  }
}
