import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import {
  TRANSLATION_MAINTENANCE_JOB_RUNNER,
  TranslationMaintenanceJobRunner,
} from "../../api/src/api/admin/controllers/translation-maintenance.job-runner";
import { AssignmentServiceV1 } from "../../api/src/api/assignment/v1/services/assignment.service";
import { AssignmentServiceV2 } from "../../api/src/api/assignment/v2/services/assignment.service";
import { QuestionService } from "../../api/src/api/assignment/v2/services/question.service";
import { AttemptServiceV2 } from "../../api/src/api/attempt/services/attempt.service";
import {
  JOB_NAMES,
  JOB_QUEUE_NAMES,
} from "../../api/src/job-queue/job-queue.constants";
import {
  AdminFixMissingTranslationsJobPayload,
  AdminSweepMissingTranslationsJobPayload,
  AssignmentV1GenerateQuestionsJobPayload,
  AssignmentV1PublishJobPayload,
  AssignmentV2GenerateQuestionsJobPayload,
  AssignmentV2PublishJobPayload,
  AttemptAuthorPreviewJobPayload,
  AttemptGradeJobPayload,
} from "../../api/src/job-queue/job-queue.types";
import { decryptJobPayload } from "../../api/src/job-queue/job-payload.crypto";
import { createRedisConnection } from "../../api/src/job-queue/redis.connection";
import { UserSessionRequest } from "../../api/src/auth/interfaces/user.session.interface";

@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWorkerService.name);
  private connection?: IORedis;
  private readonly moduleRef: ModuleRef;
  private readonly workers: Worker[] = [];

  constructor(@Inject(ModuleRef) moduleReference: unknown) {
    this.moduleRef = moduleReference as ModuleRef;
  }

  async onModuleInit(): Promise<void> {
    this.connection = createRedisConnection();

    this.workers.push(
      this.createWorker(
        JOB_QUEUE_NAMES.ASSIGNMENT_V1,
        async (job) => this.handleAssignmentV1Job(job),
        2,
      ),
      this.createWorker(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2,
        async (job) => this.handleAssignmentV2Job(job),
        2,
      ),
      this.createWorker(
        JOB_QUEUE_NAMES.ATTEMPT,
        async (job) => this.handleAttemptJob(job),
        4,
      ),
      this.createWorker(
        JOB_QUEUE_NAMES.ADMIN_TRANSLATION,
        async (job) => this.handleAdminTranslationJob(job),
        1,
      ),
    );

    await Promise.all(
      this.workers.map(async (worker) => worker.waitUntilReady()),
    );
    this.logger.log(`Started ${this.workers.length} background job workers`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map(async (worker) => worker.close()));
    if (this.connection) {
      await this.connection.quit();
    }
  }

  private createWorker(
    queueName: string,
    processor: (job: Job) => Promise<void>,
    concurrency: number,
  ): Worker {
    const worker = new Worker(queueName, processor, {
      connection: this.getConnection(),
      concurrency,
    });

    worker.on("completed", (job) => {
      this.logger.log(`Completed ${job.name}#${job.id}`);
    });

    worker.on("failed", (job, error) => {
      this.logger.error(
        `Failed ${job?.name ?? "unknown"}#${job?.id ?? "unknown"}: ${error.message}`,
        error.stack,
      );
    });

    return worker;
  }

  private getConnection(): IORedis {
    if (!this.connection) {
      this.connection = createRedisConnection();
    }

    return this.connection;
  }

  private getAssignmentServiceV1(): AssignmentServiceV1 {
    return this.moduleRef.get(AssignmentServiceV1, { strict: false });
  }

  private getAssignmentServiceV2(): AssignmentServiceV2 {
    return this.moduleRef.get(AssignmentServiceV2, { strict: false });
  }

  private getQuestionService(): QuestionService {
    return this.moduleRef.get(QuestionService, { strict: false });
  }

  private getAttemptService(): AttemptServiceV2 {
    return this.moduleRef.get(AttemptServiceV2, { strict: false });
  }

  private getTranslationJobRunner(): TranslationMaintenanceJobRunner {
    return this.moduleRef.get<TranslationMaintenanceJobRunner>(
      TRANSLATION_MAINTENANCE_JOB_RUNNER,
      { strict: false },
    );
  }

  private async handleAssignmentV1Job(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS: {
        const payload =
          this.getDecryptedJobData<AssignmentV1GenerateQuestionsJobPayload>(
            job,
          );
        await this.getAssignmentServiceV1().runGenerateQuestionsJob(
          payload.assignmentId,
          payload.jobId,
          payload.assignmentType,
          payload.questionsToGenerate,
          payload.files,
          payload.learningObjectives,
        );
        return;
      }
      case JOB_NAMES.ASSIGNMENT_V1_PUBLISH: {
        const payload =
          this.getDecryptedJobData<AssignmentV1PublishJobPayload>(job);
        await this.getAssignmentServiceV1().runPublishJob(
          payload.jobId,
          payload.assignmentId,
          payload.updateDto,
          payload.userId,
        );
        return;
      }
      default: {
        throw new Error(`Unsupported assignment v1 job: ${job.name}`);
      }
    }
  }

  private async handleAssignmentV2Job(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS: {
        const payload =
          this.getDecryptedJobData<AssignmentV2GenerateQuestionsJobPayload>(
            job,
          );
        await this.getQuestionService().runQuestionGenerationJob(
          payload.assignmentId,
          payload.jobId,
          payload.assignmentType,
          payload.questionsToGenerate,
          payload.fileContents,
          payload.learningObjectives,
        );
        return;
      }
      case JOB_NAMES.ASSIGNMENT_V2_PUBLISH: {
        const payload =
          this.getDecryptedJobData<AssignmentV2PublishJobPayload>(job);
        await this.getAssignmentServiceV2().runPublishJob(
          payload.jobId,
          payload.assignmentId,
          payload.updateDto,
          payload.userId,
        );
        return;
      }
      default: {
        throw new Error(`Unsupported assignment v2 job: ${job.name}`);
      }
    }
  }

  private async handleAttemptJob(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.ATTEMPT_GRADE: {
        const payload = this.getDecryptedJobData<AttemptGradeJobPayload>(job);
        await this.getAttemptService().processGradingJob(
          payload.gradingJobId,
          payload.attemptId,
          payload.assignmentId,
          payload.updateDto,
          payload.authCookie ?? "",
          { userSession: payload.userSession } as UserSessionRequest,
        );
        return;
      }
      case JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW: {
        const payload =
          this.getDecryptedJobData<AttemptAuthorPreviewJobPayload>(job);
        await this.getAttemptService().processAuthorPreviewJob(
          payload.gradingJobId,
          payload.assignmentId,
          payload.updateDto,
          "",
          { userSession: payload.userSession } as UserSessionRequest,
        );
        return;
      }
      default: {
        throw new Error(`Unsupported attempt job: ${job.name}`);
      }
    }
  }

  private async handleAdminTranslationJob(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.ADMIN_FIX_MISSING_TRANSLATIONS: {
        const payload =
          this.getDecryptedJobData<AdminFixMissingTranslationsJobPayload>(job);
        await this.getTranslationJobRunner().runFixMissingTranslationsJob(
          payload.jobId,
          payload.assignmentIds,
          payload.body,
        );
        return;
      }
      case JOB_NAMES.ADMIN_SWEEP_MISSING_TRANSLATIONS: {
        const payload =
          this.getDecryptedJobData<AdminSweepMissingTranslationsJobPayload>(
            job,
          );
        await this.getTranslationJobRunner().runSweepMissingTranslationsJob(
          payload.jobId,
          payload.body,
        );
        return;
      }
      default: {
        throw new Error(`Unsupported admin translation job: ${job.name}`);
      }
    }
  }

  private getDecryptedJobData<T>(job: Job): T {
    return decryptJobPayload<T>(job.data);
  }
}
