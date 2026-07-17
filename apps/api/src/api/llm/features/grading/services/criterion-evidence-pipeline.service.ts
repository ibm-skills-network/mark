import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  CriterionEvidenceResponse,
  CriterionGrade,
  CriterionAttempt,
  EvidenceAuditLog,
  ExtractedChunk,
  GradeSummary,
  JudgeCritique,
  RubricCriterion,
} from "../types/criterion-evidence.types";
import { ChunkIndex } from "./chunk-index.service";
import { ConcurrencyLimiter } from "./concurrency-limiter";
import {
  CriterionEvidenceRetrievalService,
  LlmCallRecorder,
} from "./criterion-evidence-retrieval.service";
import { CriterionGradingService } from "./criterion-grading.service";
import { CriterionJudgeService } from "./criterion-judge.service";
import { CriterionRetryManagerService } from "./criterion-retry-manager.service";
import { CriterionGradeCompilerService } from "./criterion-grade-compiler.service";

interface PipelineRequest {
  question: string;
  criteria: RubricCriterion[];
  chunks: ExtractedChunk[];
  assignmentId: number;
  language?: string;
  judgeFeedback?: string;
  maxConcurrency?: number;
  maxRetries?: number;
  modelOverrides?: {
    retrievalModel?: string;
    gradingModel?: string;
    judgeModel?: string;
  };
  modelOverridesAreFinal?: boolean;
}

interface PipelineResult {
  grades: CriterionGrade[];
  evidence: CriterionEvidenceResponse[];
  judgeCritiques: JudgeCritique[];
  summary: GradeSummary;
  audit: EvidenceAuditLog;
}

class AuditCollector implements LlmCallRecorder {
  private readonly llmCalls: EvidenceAuditLog["llmCalls"] = [];

  record(parameters: {
    purpose: "retrieval" | "validation" | "grading" | "judge";
    model: string;
    prompt: string;
    response: string;
    durationMs: number;
  }): void {
    const promptHash = crypto
      .createHash("sha256")
      .update(parameters.prompt)
      .digest("hex");
    const responseHash = crypto
      .createHash("sha256")
      .update(parameters.response)
      .digest("hex");

    this.llmCalls.push({
      purpose: parameters.purpose,
      model: parameters.model,
      promptHash,
      responseHash,
      durationMs: parameters.durationMs,
    });
  }

  getCalls(): EvidenceAuditLog["llmCalls"] {
    return this.llmCalls;
  }
}

@Injectable()
export class CriterionEvidencePipelineService {
  private readonly logger = new Logger(CriterionEvidencePipelineService.name);

  constructor(
    private readonly evidenceRetrieval: CriterionEvidenceRetrievalService,
    private readonly gradingService: CriterionGradingService,
    private readonly judgeService: CriterionJudgeService,
    private readonly retryManager: CriterionRetryManagerService,
    private readonly compiler: CriterionGradeCompilerService,
  ) {}

  async gradeWithEvidence(request: PipelineRequest): Promise<PipelineResult> {
    const auditCollector = new AuditCollector();
    const index = new ChunkIndex(request.chunks);
    const limiter = new ConcurrencyLimiter(request.maxConcurrency ?? 6);
    const maxRetries = request.maxRetries ?? 3;

    const evidenceResponses = await limiter.run(
      request.criteria.map(
        (criterion) => async () =>
          this.evidenceRetrieval.retrieveEvidence(
            {
              criterion,
              question: request.question,
              chunks: request.chunks,
              assignmentId: request.assignmentId,
              language: request.language,
              modelOverride: request.modelOverrides?.retrievalModel,
              modelOverrideIsFinal: request.modelOverridesAreFinal,
            },
            index,
            auditCollector,
          ),
      ),
    );

    const evidenceMap = new Map(
      evidenceResponses.map((response) => [response.criterionId, response]),
    );

    const grades = await limiter.run(
      request.criteria.map((criterion) => async () => {
        const evidence = evidenceMap.get(criterion.id)?.evidence || [];
        return this.gradingService.gradeCriterion(
          {
            criterion,
            evidence,
            question: request.question,
            assignmentId: request.assignmentId,
            language: request.language,
            judgeFeedback: request.judgeFeedback,
            attempt: 1,
            modelOverride: request.modelOverrides?.gradingModel,
            modelOverrideIsFinal: request.modelOverridesAreFinal,
          },
          auditCollector,
        );
      }),
    );

    let judgeCritique = await this.judgeService.judge(
      {
        question: request.question,
        criteria: request.criteria,
        grades,
        evidence: evidenceResponses,
        assignmentId: request.assignmentId,
        language: request.language,
        modelOverride: request.modelOverrides?.judgeModel,
        modelOverrideIsFinal: request.modelOverridesAreFinal,
      },
      auditCollector,
    );

    const judgeCritiques: JudgeCritique[] = [judgeCritique];

    const attemptHistoryMap = new Map<string, CriterionAttempt[]>();

    const storeAttempt = (grade: CriterionGrade, issues: JudgeCritique) => {
      const issueList = issues.issues.filter(
        (item) => item.criterionId === grade.criterionId,
      );
      const attempts = attemptHistoryMap.get(grade.criterionId) || [];
      attemptHistoryMap.set(
        grade.criterionId,
        this.retryManager.attachAttempt(attempts, grade, issueList),
      );
    };

    for (const grade of grades) storeAttempt(grade, judgeCritique);

    let currentGrades = [...grades];
    let retryCount = 0;

    while (!judgeCritique.approved && retryCount < maxRetries) {
      const attempt = retryCount + 2;
      const flagged = new Set(
        judgeCritique.issues.map((issue) => issue.criterionId),
      );

      if (flagged.size === 0) {
        break;
      }

      const updatedGrades = await limiter.run(
        request.criteria.map((criterion) => async () => {
          const existing = currentGrades.find(
            (grade) => grade.criterionId === criterion.id,
          );

          if (!existing || !flagged.has(criterion.id)) {
            return (
              existing ??
              (await this.gradingService.gradeCriterion(
                {
                  criterion,
                  evidence: evidenceMap.get(criterion.id)?.evidence || [],
                  question: request.question,
                  assignmentId: request.assignmentId,
                  language: request.language,
                  attempt,
                  modelOverride: request.modelOverrides?.gradingModel,
                  modelOverrideIsFinal: request.modelOverridesAreFinal,
                },
                auditCollector,
              ))
            );
          }

          const issues = judgeCritique.issues
            .filter((issue) => issue.criterionId === criterion.id)
            .map((issue) => `- ${issue.severity}: ${issue.issue}`)
            .join("\n");

          return this.gradingService.gradeCriterion(
            {
              criterion,
              evidence: evidenceMap.get(criterion.id)?.evidence || [],
              question: request.question,
              assignmentId: request.assignmentId,
              language: request.language,
              judgeFeedback: issues || request.judgeFeedback,
              attempt,
              modelOverride: request.modelOverrides?.gradingModel,
              modelOverrideIsFinal: request.modelOverridesAreFinal,
            },
            auditCollector,
          );
        }),
      );

      currentGrades = updatedGrades;

      judgeCritique = await this.judgeService.judge(
        {
          question: request.question,
          criteria: request.criteria,
          grades: currentGrades,
          evidence: evidenceResponses,
          assignmentId: request.assignmentId,
          language: request.language,
          modelOverride: request.modelOverrides?.judgeModel,
          modelOverrideIsFinal: request.modelOverridesAreFinal,
        },
        auditCollector,
      );

      judgeCritiques.push(judgeCritique);
      for (const grade of currentGrades) storeAttempt(grade, judgeCritique);
      retryCount += 1;
    }

    let finalSelectionReason = "judge_approved";

    if (!judgeCritique.approved) {
      this.logger.warn(
        `Judge did not approve after ${maxRetries} retries. Selecting best supported attempts.`,
      );

      const selectedGrades: CriterionGrade[] = [];
      for (const criterion of request.criteria) {
        const history = attemptHistoryMap.get(criterion.id) || [];
        if (history.length === 0) {
          const fallback = currentGrades.find(
            (grade) => grade.criterionId === criterion.id,
          );
          if (fallback) selectedGrades.push(fallback);
          continue;
        }
        const bestAttempt = this.retryManager.selectBestAttempt(history);
        selectedGrades.push(bestAttempt.grade);
      }
      currentGrades = selectedGrades;
      finalSelectionReason = "highest_support_score";
    }

    const summary = this.compiler.compile(currentGrades);

    const finalSelection = currentGrades.map((grade) => {
      const history = attemptHistoryMap.get(grade.criterionId) || [];
      const match = history.find(
        (attempt) => attempt.attempt === grade.attempt,
      );
      const selected =
        match ||
        (history.length > 0
          ? this.retryManager.selectBestAttempt(history)
          : undefined);

      return {
        criterionId: grade.criterionId,
        attempt: selected?.attempt ?? grade.attempt,
        supportScore: selected?.support.supportScore ?? 0,
        reason: finalSelectionReason,
      };
    });

    const audit = this.buildAuditLog(
      request,
      evidenceResponses,
      attemptHistoryMap,
      judgeCritiques,
      auditCollector.getCalls(),
      finalSelection,
    );

    return {
      grades: currentGrades,
      evidence: evidenceResponses,
      judgeCritiques,
      summary,
      audit,
    };
  }

  private buildAuditLog(
    request: PipelineRequest,
    evidence: CriterionEvidenceResponse[],
    attemptsMap: Map<string, CriterionAttempt[]>,
    judgeCritiques: JudgeCritique[],
    llmCalls: EvidenceAuditLog["llmCalls"],
    finalSelection: EvidenceAuditLog["finalSelection"],
  ): EvidenceAuditLog {
    const rubricHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(request.criteria))
      .digest("hex");

    const chunkHashes = request.chunks.map((chunk) => chunk.hash);

    const gradingAttempts = [...attemptsMap.values()].flat();

    return {
      rubricHash,
      chunkHashes,
      evidenceRetrieval: evidence,
      gradingAttempts,
      judgeCritiques,
      finalSelection,
      llmCalls,
      createdAt: new Date().toISOString(),
    };
  }
}
