import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { GradingKillSwitchService } from "../api/ai-feature-flags/grading-kill-switch.service";
import {
  AttemptServiceV2,
  GradingJobRequester,
} from "../api/attempt/services/attempt.service";
import { UserRole } from "../auth/interfaces/user.session.interface";
import { DataTransform } from "../common/interceptors/data-transform.interceptor";
import { buildGradingActiveKey } from "./grading-active-key";
import {
  InternalGradingActiveJobQueryDto,
  InternalGradingActiveJobResponse,
  InternalGradingEnqueueRequestDto,
  InternalGradingEnqueueResponse,
} from "./internal-grading.dto";
import { JobQueueSecretGuard } from "./job-queue-secret.guard";
import { JobStateService } from "./job-state.service";

/** Fields of the shared submit DTO that only author previews may carry. */
const AUTHOR_ONLY_UPDATE_FIELDS = [
  "authorQuestions",
  "authorAssignmentDetails",
  "preTranslatedQuestions",
  "expiresAt",
] as const;

/**
 * Grading queue access for in-cluster services that accept learner submits
 * but do not own the Redis job state or the BullMQ queues. Reachable only
 * with the shared job-queue secret. The caller has already run the submit
 * checks, so only the shape and the kill switch are checked here, and
 * nothing is decoded.
 */
@Controller("internal/grading")
@UseGuards(JobQueueSecretGuard)
// Values arrive decoded and leave as plain JSON.
@DataTransform({ encodeResponse: false, decodeRequest: false })
export class InternalGradingController {
  private readonly logger: Logger;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    private readonly attemptService: AttemptServiceV2,
    private readonly jobStateService: JobStateService,
    private readonly gradingKillSwitch: GradingKillSwitchService,
  ) {
    this.logger = parentLogger.child({
      context: InternalGradingController.name,
    });
  }

  @Post("enqueue")
  @HttpCode(200)
  async enqueue(
    @Body() body: InternalGradingEnqueueRequestDto,
  ): Promise<InternalGradingEnqueueResponse> {
    const logContext = {
      assignment_id: body.assignmentId,
      attempt_id: body.attemptId,
      user_id: body.userId,
      tier: body.tier,
    };
    this.logger.info("internal_grading.enqueue.requested", logContext);

    const authorField = AUTHOR_ONLY_UPDATE_FIELDS.find(
      (field) => body.updateDto[field] !== undefined,
    );
    if (authorField) {
      this.logger.warn("internal_grading.enqueue.rejected", {
        ...logContext,
        reason: "author_only_field",
        field: authorField,
      });
      throw new BadRequestException("Invalid grading request");
    }

    const submissionReceivedAt = new Date(body.submissionReceivedAt);

    await this.gradingKillSwitch.assertGradingAllowed(
      body.assignmentId,
      body.userId,
      "submit",
    );

    const requester: GradingJobRequester = {
      userSession: {
        userId: body.userId,
        role: UserRole.LEARNER,
        gradingCallbackRequired: body.gradingCallbackRequired,
      },
    };
    const authCookie = body.authCookie ?? "";

    let gradingJobId: string | undefined;
    try {
      const created = await this.attemptService.createGradingJob(
        body.attemptId,
        body.assignmentId,
        body.updateDto,
        authCookie,
        requester,
        body.tier,
      );
      gradingJobId = created.gradingJobId;

      await this.attemptService.enqueueGradingJob(
        created.gradingJobId,
        body.attemptId,
        body.assignmentId,
        body.updateDto,
        authCookie,
        requester,
        created.queueName,
        submissionReceivedAt,
      );

      this.logger.info("internal_grading.enqueue.accepted", {
        ...logContext,
        grading_job_id: created.gradingJobId,
        reused: created.reused,
        queue_name: created.queueName,
      });
      return {
        gradingJobId: created.gradingJobId,
        reused: created.reused,
        message: created.message,
      };
    } catch (error) {
      this.logger.error("internal_grading.enqueue.failed", {
        ...logContext,
        grading_job_id: gradingJobId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  @Get("active-job")
  async activeJob(
    @Query() query: InternalGradingActiveJobQueryDto,
  ): Promise<InternalGradingActiveJobResponse> {
    const assignmentId = Number(query.assignmentId);
    const attemptId = Number(query.attemptId);
    const logContext = {
      assignment_id: assignmentId,
      attempt_id: attemptId,
      user_id: query.userId,
    };

    try {
      const job = await this.jobStateService.findActiveJob(
        buildGradingActiveKey(query.userId, assignmentId, attemptId),
      );
      const gradingJobId = job?.id ?? null;
      this.logger.info("internal_grading.active_job.read", {
        ...logContext,
        grading_job_id: gradingJobId,
      });
      return { gradingJobId };
    } catch (error) {
      this.logger.error("internal_grading.active_job.failed", {
        ...logContext,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
}
