import { Injectable, Inject, Logger } from "@nestjs/common";
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
import {
  LLM_RESOLVER_SERVICE,
  PROMPT_PROCESSOR,
  isGradingJudgeEnabled,
} from "../../../llm.constants";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
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
  modelOverrideIsFinal?: boolean;
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
