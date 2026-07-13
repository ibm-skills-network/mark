import { Injectable, Inject, Logger } from "@nestjs/common";
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
import {
  LLM_RESOLVER_SERVICE,
  PROMPT_PROCESSOR,
  isGradingJudgeEnabled,
} from "../../../llm.constants";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
import { extractStructuredJSON } from "../../../core/utils/structured-json.util";
import { buildCriterionJudgePrompt } from "../prompts/criterion-judge.prompt";
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
    if (!isGradingJudgeEnabled()) {
      this.logger.debug(
        `Criterion judge disabled via ENABLE_GRADING_JUDGE; auto-approving grades for assignment ${request.assignmentId}`,
      );
      return {
        approved: true,
        issues: [],
        summary: "Judge disabled (ENABLE_GRADING_JUDGE)",
      };
    }

    const parser = StructuredOutputParser.fromZodSchema(JudgeCritiqueSchema);
    const formatInstructions = parser.getFormatInstructions();

    const prompt = buildCriterionJudgePrompt({
      question: request.question,
      criteria: request.criteria,
      grades: request.grades,
      evidence: request.evidence,
      formatInstructions,
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
