import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  TRANSLATION_MAINTENANCE_JOB_RUNNER,
  TranslationMaintenanceJobRunner,
} from "../api/admin/controllers/translation-maintenance.job-runner";
import { AssignmentServiceV1 } from "../api/assignment/v1/services/assignment.service";
import { AssignmentServiceV2 } from "../api/assignment/v2/services/assignment.service";
import { QuestionService as AssignmentQuestionServiceV2 } from "../api/assignment/v2/services/question.service";
import { TranslationService } from "../api/assignment/v2/services/translation.service";
import { AttemptServiceV2 } from "../api/attempt/services/attempt.service";
import { UserSessionRequest } from "../auth/interfaces/user.session.interface";
import {
  JOB_NAMES,
  JOB_QUEUE_NAMES,
  JobName,
  JobQueueName,
} from "./job-queue.constants";
import {
  AdminFixMissingTranslationsJobPayload,
  AdminSweepMissingTranslationsJobPayload,
  AssignmentV1GenerateQuestionsJobPayload,
  AssignmentV2GenerateQuestionsJobPayload,
  AssignmentV2PublishJobPayload,
  AssignmentV2RetryFailedTranslationsJobPayload,
  AttemptAuthorPreviewJobPayload,
  AttemptGradeJobPayload,
  TranslateMetaJobPayload,
  TranslateQuestionJobPayload,
  TranslateVariantJobPayload,
} from "./job-queue.types";

export interface JobExecutionRequest {
  queueName: JobQueueName;
  jobName: JobName;
  payload: unknown;
  bullJobId?: string;
  /** 0-indexed attempt counter forwarded from BullMQ job.attemptsMade. */
  attemptsMade?: number;
  /** Max attempts forwarded from BullMQ job.opts.attempts. */
  maxAttempts?: number;
}

@Injectable()
export class JobExecutorService {
  private readonly logger: Logger;

  constructor(
    private readonly assignmentServiceV1: AssignmentServiceV1,
    private readonly assignmentServiceV2: AssignmentServiceV2,
    private readonly assignmentQuestionServiceV2: AssignmentQuestionServiceV2,
    private readonly attemptService: AttemptServiceV2,
    @Inject(TRANSLATION_MAINTENANCE_JOB_RUNNER)
    private readonly translationRunner: TranslationMaintenanceJobRunner,
    private readonly translationService: TranslationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: JobExecutorService.name });
  }

  async executeJob(request: JobExecutionRequest): Promise<void> {
    switch (request.queueName) {
      case JOB_QUEUE_NAMES.ASSIGNMENT_V1: {
        return this.executeAssignmentV1Job(request.jobName, request.payload);
      }
      case JOB_QUEUE_NAMES.ASSIGNMENT_V2: {
        return this.executeAssignmentV2Job(request.jobName, request.payload);
      }
      case JOB_QUEUE_NAMES.ATTEMPT: {
        return this.executeAttemptJob(request.jobName, request.payload);
      }
      case JOB_QUEUE_NAMES.ADMIN_TRANSLATION: {
        return this.executeAdminTranslationJob(
          request.jobName,
          request.payload,
        );
      }
      case JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS: {
        return this.executeTranslationJob(
          request.jobName,
          request.payload,
          request.attemptsMade ?? 0,
          request.maxAttempts ?? 1,
        );
      }
      default: {
        throw new BadRequestException(
          `Unsupported job queue: ${JSON.stringify(request.queueName)}`,
        );
      }
    }
  }

  private async executeAssignmentV1Job(
    jobName: JobName,
    payload: unknown,
  ): Promise<void> {
    switch (jobName) {
      case JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS: {
        const jobPayload = payload as AssignmentV1GenerateQuestionsJobPayload;
        await this.assignmentServiceV1.runGenerateQuestionsJob(
          jobPayload.assignmentId,
          jobPayload.jobId,
          jobPayload.assignmentType,
          jobPayload.questionsToGenerate,
          jobPayload.files,
          jobPayload.learningObjectives,
        );
        return;
      }
      default: {
        throw new BadRequestException(
          `Unsupported assignment v1 job: ${jobName}`,
        );
      }
    }
  }

  private async executeAssignmentV2Job(
    jobName: JobName,
    payload: unknown,
  ): Promise<void> {
    switch (jobName) {
      case JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS: {
        const jobPayload = payload as AssignmentV2GenerateQuestionsJobPayload;
        await this.assignmentQuestionServiceV2.runQuestionGenerationJob(
          jobPayload.assignmentId,
          jobPayload.jobId,
          jobPayload.assignmentType,
          jobPayload.questionsToGenerate,
          jobPayload.fileContents,
          jobPayload.learningObjectives,
        );
        return;
      }
      case JOB_NAMES.ASSIGNMENT_V2_PUBLISH: {
        const jobPayload = payload as AssignmentV2PublishJobPayload;
        await this.assignmentServiceV2.runPublishJob(
          jobPayload.jobId,
          jobPayload.assignmentId,
          jobPayload.updateDto,
          jobPayload.userId,
        );
        return;
      }
      case JOB_NAMES.ASSIGNMENT_V2_RETRY_FAILED_TRANSLATIONS: {
        const jobPayload =
          payload as AssignmentV2RetryFailedTranslationsJobPayload;
        await this.assignmentServiceV2.runRetryFailedTranslations(
          jobPayload.jobId,
          jobPayload.assignmentId,
          jobPayload.sourcePublishJobId,
          jobPayload.userId,
        );
        return;
      }
      default: {
        throw new BadRequestException(
          `Unsupported assignment v2 job: ${jobName}`,
        );
      }
    }
  }

  private async executeAttemptJob(
    jobName: JobName,
    payload: unknown,
  ): Promise<void> {
    switch (jobName) {
      case JOB_NAMES.ATTEMPT_GRADE: {
        const jobPayload = payload as AttemptGradeJobPayload;
        await this.attemptService.processGradingJob(
          jobPayload.gradingJobId,
          jobPayload.attemptId,
          jobPayload.assignmentId,
          jobPayload.updateDto,
          jobPayload.authCookie ?? "",
          { userSession: jobPayload.userSession } as UserSessionRequest,
        );
        return;
      }
      case JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW: {
        const jobPayload = payload as AttemptAuthorPreviewJobPayload;
        await this.attemptService.processAuthorPreviewJob(
          jobPayload.gradingJobId,
          jobPayload.assignmentId,
          jobPayload.updateDto,
          "",
          { userSession: jobPayload.userSession } as UserSessionRequest,
        );
        return;
      }
      default: {
        throw new BadRequestException(`Unsupported attempt job: ${jobName}`);
      }
    }
  }

  private async executeAdminTranslationJob(
    jobName: JobName,
    payload: unknown,
  ): Promise<void> {
    switch (jobName) {
      case JOB_NAMES.ADMIN_FIX_MISSING_TRANSLATIONS: {
        const jobPayload = payload as AdminFixMissingTranslationsJobPayload;
        await this.translationRunner.runFixMissingTranslationsJob(
          jobPayload.jobId,
          jobPayload.assignmentIds,
          jobPayload.body,
        );
        return;
      }
      case JOB_NAMES.ADMIN_SWEEP_MISSING_TRANSLATIONS: {
        const jobPayload = payload as AdminSweepMissingTranslationsJobPayload;
        await this.translationRunner.runSweepMissingTranslationsJob(
          jobPayload.jobId,
          jobPayload.body,
        );
        return;
      }
      default: {
        throw new BadRequestException(
          `Unsupported admin translation job: ${jobName}`,
        );
      }
    }
  }

  private async executeTranslationJob(
    jobName: JobName,
    payload: unknown,
    attemptsMade: number,
    maxAttempts: number,
  ): Promise<void> {
    const startTime = Date.now();
    const isFinalAttempt = attemptsMade + 1 >= maxAttempts;

    switch (jobName) {
      case JOB_NAMES.TRANSLATE_QUESTION: {
        const jobPayload = payload as TranslateQuestionJobPayload;
        const forceRetranslation = this.resolveForceRetranslation(
          jobPayload.forceRetranslation,
          attemptsMade,
        );
        try {
          const { inserted, skipped, failed } =
            await this.translationService.translateQuestion(
              jobPayload.assignmentId,
              jobPayload.questionId,
              jobPayload.question,
              jobPayload.parentJobId,
              forceRetranslation,
              isFinalAttempt,
            );
          this.throwIfRetryableLanguageFailures(failed, isFinalAttempt, {
            assignmentId: jobPayload.assignmentId,
            kind: "question",
            id: jobPayload.questionId,
            jobId: jobPayload.parentJobId,
            attemptsMade,
            maxAttempts,
          });
          this.logger.info("publish.translation.job.executor.complete", {
            assignmentId: jobPayload.assignmentId,
            kind: "question",
            id: jobPayload.questionId,
            jobId: jobPayload.parentJobId,
            inserted,
            skipped,
            failed,
            durationMs: Date.now() - startTime,
          });
        } catch (error) {
          if (isFinalAttempt) {
            if (jobPayload.parentJobId) {
              await this.translationService.markPublishTranslationFailed(
                jobPayload.parentJobId,
                "question",
                jobPayload.questionId,
              );
            }
            await this.translationService.rollbackOneInflightSeed(
              jobPayload.assignmentId,
            );
          }
          throw error;
        }
        return;
      }
      case JOB_NAMES.TRANSLATE_VARIANT: {
        const jobPayload = payload as TranslateVariantJobPayload;
        const forceRetranslation = this.resolveForceRetranslation(
          jobPayload.forceRetranslation,
          attemptsMade,
        );
        try {
          const { inserted, skipped, failed } =
            await this.translationService.translateVariant(
              jobPayload.assignmentId,
              jobPayload.questionId,
              jobPayload.variantId,
              jobPayload.variant,
              jobPayload.parentJobId,
              forceRetranslation,
              isFinalAttempt,
            );
          this.throwIfRetryableLanguageFailures(failed, isFinalAttempt, {
            assignmentId: jobPayload.assignmentId,
            kind: "variant",
            id: jobPayload.variantId,
            jobId: jobPayload.parentJobId,
            attemptsMade,
            maxAttempts,
          });
          this.logger.info("publish.translation.job.executor.complete", {
            assignmentId: jobPayload.assignmentId,
            kind: "variant",
            id: jobPayload.variantId,
            jobId: jobPayload.parentJobId,
            inserted,
            skipped,
            failed,
            durationMs: Date.now() - startTime,
          });
        } catch (error) {
          if (isFinalAttempt) {
            if (jobPayload.parentJobId) {
              await this.translationService.markPublishTranslationFailed(
                jobPayload.parentJobId,
                "variant",
                jobPayload.variantId,
              );
            }
            await this.translationService.rollbackOneInflightSeed(
              jobPayload.assignmentId,
            );
          }
          throw error;
        }
        return;
      }
      case JOB_NAMES.TRANSLATE_META: {
        const jobPayload = payload as TranslateMetaJobPayload;
        try {
          const { inserted, skipped, failed } =
            await this.translationService.translateAssignment(
              jobPayload.assignmentId,
              jobPayload.parentJobId,
              undefined,
              isFinalAttempt,
            );
          this.throwIfRetryableLanguageFailures(failed, isFinalAttempt, {
            assignmentId: jobPayload.assignmentId,
            kind: "meta",
            id: jobPayload.assignmentId,
            jobId: jobPayload.parentJobId,
            attemptsMade,
            maxAttempts,
          });
          this.logger.info("publish.translation.job.executor.complete", {
            assignmentId: jobPayload.assignmentId,
            kind: "meta",
            id: jobPayload.assignmentId,
            jobId: jobPayload.parentJobId,
            inserted,
            skipped,
            failed,
            durationMs: Date.now() - startTime,
          });
        } catch (error) {
          if (isFinalAttempt) {
            if (jobPayload.parentJobId) {
              await this.translationService.markPublishTranslationFailed(
                jobPayload.parentJobId,
                "meta",
                jobPayload.assignmentId,
              );
            }
            await this.translationService.rollbackOneInflightSeed(
              jobPayload.assignmentId,
            );
          }
          throw error;
        }
        return;
      }
      default: {
        throw new BadRequestException(
          `Unsupported translation job: ${jobName}`,
        );
      }
    }
  }

  /**
   * Retry attempts must not force-retranslate: the first attempt already
   * wrote every language that succeeded, and forcing would delete those
   * rows and redo all of them. forceRetranslation: false fills only the
   * still-missing languages.
   */
  private resolveForceRetranslation(
    requested: boolean | undefined,
    attemptsMade: number,
  ): boolean {
    return (requested ?? true) && attemptsMade === 0;
  }

  /**
   * A translation run that completes with failed languages returns a
   * normal outcome instead of throwing, so without this check the BullMQ
   * job would be marked successful and its remaining attempts would never
   * run — the user would have to press "Retry" by hand. Throwing here
   * hands the job back to BullMQ; the retry attempt runs with
   * forceRetranslation: false and fills only the missing languages.
   * On the final attempt the partial outcome stands and the run's own
   * terminal status (failed) is what the user sees.
   */
  private throwIfRetryableLanguageFailures(
    failed: number,
    isFinalAttempt: boolean,
    context: {
      assignmentId: number;
      kind: "question" | "variant" | "meta";
      id: number;
      jobId: string | undefined;
      attemptsMade: number;
      maxAttempts: number;
    },
  ): void {
    if (failed === 0 || isFinalAttempt) return;
    this.logger.warn("publish.translation.job.executor.partial-failure", {
      assignmentId: context.assignmentId,
      kind: context.kind,
      id: context.id,
      jobId: context.jobId,
      failed,
      attempt: context.attemptsMade + 1,
      maxAttempts: context.maxAttempts,
    });
    throw new Error(
      `Translation for ${context.kind} ${context.id} left ${failed} language(s) untranslated; handing back to BullMQ for retry`,
    );
  }
}
