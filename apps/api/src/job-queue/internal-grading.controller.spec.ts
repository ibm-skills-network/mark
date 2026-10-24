import {
  ArgumentMetadata,
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  ValidationPipe,
} from "@nestjs/common";
import { AiTemporarilyDisabledException } from "../api/ai-feature-flags/ai-temporarily-disabled.exception";
import {
  GRADING_JOB_CREATED_MESSAGE,
  GRADING_JOB_REUSED_MESSAGE,
} from "../api/attempt/services/attempt.service";
import { UserRole } from "../auth/interfaces/user.session.interface";
import { InternalGradingController } from "./internal-grading.controller";
import {
  InternalGradingActiveJobQueryDto,
  InternalGradingEnqueueRequestDto,
} from "./internal-grading.dto";
import { getJobQueueSecret } from "./job-payload.crypto";
import { JobQueueSecretGuard } from "./job-queue-secret.guard";

const makeLogger = () => {
  const logger = {
    child: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
};

const validBody = (): InternalGradingEnqueueRequestDto => ({
  assignmentId: 7,
  attemptId: 42,
  userId: "learner@example.com",
  gradingCallbackRequired: true,
  authCookie: "jwt-cookie",
  submissionReceivedAt: "2026-10-24T12:00:00.000Z",
  tier: "standard",
  updateDto: {
    submitted: true,
    responsesForQuestions: [{ id: 3, learnerTextResponse: "my answer" }],
    language: "en",
  },
});

const makeController = () => {
  const logger = makeLogger();
  const attemptService = {
    createGradingJob: jest.fn().mockResolvedValue({
      gradingJobId: "job-new",
      message: GRADING_JOB_CREATED_MESSAGE,
      queueName: "mark.attempt",
      reused: false,
    }),
    enqueueGradingJob: jest.fn().mockResolvedValue(undefined),
  };
  const jobStateService = {
    findActiveJob: jest.fn().mockResolvedValue(null),
  };
  const killSwitch = {
    assertGradingAllowed: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new InternalGradingController(
    logger as never,
    attemptService as never,
    jobStateService as never,
    killSwitch as never,
  );
  return { controller, logger, attemptService, jobStateService, killSwitch };
};

describe("JobQueueSecretGuard", () => {
  const contextWith = (headers: Record<string, string | string[]>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          method: "POST",
          originalUrl: "/api/internal/grading/enqueue",
          get: () => undefined,
        }),
      }),
    }) as unknown as ExecutionContext;

  it("admits the shared secret", () => {
    const guard = new JobQueueSecretGuard(makeLogger() as never);
    expect(
      guard.canActivate(
        contextWith({ "x-job-queue-secret": getJobQueueSecret() }),
      ),
    ).toBe(true);
  });

  it("refuses a missing secret with 403", () => {
    const logger = makeLogger();
    const guard = new JobQueueSecretGuard(logger as never);
    expect(() => guard.canActivate(contextWith({}))).toThrow(
      ForbiddenException,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("internal_auth_denied"),
      expect.objectContaining({ denial_reason: "missing_job_queue_secret" }),
    );
  });

  it("refuses a wrong secret with 403 and never logs it", () => {
    const logger = makeLogger();
    const guard = new JobQueueSecretGuard(logger as never);
    const wrong = `${getJobQueueSecret()}x`;
    expect(() =>
      guard.canActivate(contextWith({ "x-job-queue-secret": wrong })),
    ).toThrow(ForbiddenException);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(wrong);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ denial_reason: "invalid_job_queue_secret" }),
    );
  });

  it("uses the first value of a repeated header", () => {
    const guard = new JobQueueSecretGuard(makeLogger() as never);
    expect(
      guard.canActivate(
        contextWith({ "x-job-queue-secret": [getJobQueueSecret(), "other"] }),
      ),
    ).toBe(true);
  });
});

describe("InternalGradingController.enqueue", () => {
  it("creates and enqueues a learner grading job", async () => {
    const { controller, attemptService, killSwitch, logger } = makeController();
    const body = validBody();

    await expect(controller.enqueue(body)).resolves.toEqual({
      gradingJobId: "job-new",
      reused: false,
      message: GRADING_JOB_CREATED_MESSAGE,
    });

    expect(killSwitch.assertGradingAllowed).toHaveBeenCalledWith(
      7,
      "learner@example.com",
      "submit",
    );
    const requester = {
      userSession: {
        userId: "learner@example.com",
        role: UserRole.LEARNER,
        gradingCallbackRequired: true,
      },
    };
    expect(attemptService.createGradingJob).toHaveBeenCalledWith(
      42,
      7,
      body.updateDto,
      "jwt-cookie",
      requester,
      "standard",
    );
    expect(attemptService.enqueueGradingJob).toHaveBeenCalledWith(
      "job-new",
      42,
      7,
      body.updateDto,
      "jwt-cookie",
      requester,
      "mark.attempt",
      new Date("2026-10-24T12:00:00.000Z"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "internal_grading.enqueue.accepted",
      expect.objectContaining({
        assignment_id: 7,
        attempt_id: 42,
        user_id: "learner@example.com",
        tier: "standard",
        grading_job_id: "job-new",
        reused: false,
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("jwt-cookie");
  });

  it("reports a reused in-flight job", async () => {
    const { controller, attemptService } = makeController();
    attemptService.createGradingJob.mockResolvedValue({
      gradingJobId: "job-running",
      message: GRADING_JOB_REUSED_MESSAGE,
      queueName: "mark.attempt.heavy",
      reused: true,
    });

    await expect(
      controller.enqueue({ ...validBody(), tier: "heavy" }),
    ).resolves.toEqual({
      gradingJobId: "job-running",
      reused: true,
      message: GRADING_JOB_REUSED_MESSAGE,
    });
    expect(attemptService.createGradingJob).toHaveBeenCalledWith(
      42,
      7,
      expect.anything(),
      "jwt-cookie",
      expect.anything(),
      "heavy",
    );
  });

  it("passes an empty cookie when none is sent", async () => {
    const { controller, attemptService } = makeController();
    const body = validBody();
    delete body.authCookie;

    await controller.enqueue(body);

    expect(attemptService.enqueueGradingJob.mock.calls[0][4]).toBe("");
  });

  it("lets the kill switch 409 through without creating a job", async () => {
    const { controller, attemptService, killSwitch } = makeController();
    killSwitch.assertGradingAllowed.mockRejectedValue(
      new AiTemporarilyDisabledException(),
    );

    await expect(controller.enqueue(validBody())).rejects.toBeInstanceOf(
      AiTemporarilyDisabledException,
    );
    expect(attemptService.createGradingJob).not.toHaveBeenCalled();
    expect(attemptService.enqueueGradingJob).not.toHaveBeenCalled();
  });

  it("rethrows an enqueue failure after logging it", async () => {
    const { controller, attemptService, logger } = makeController();
    attemptService.enqueueGradingJob.mockRejectedValue(new Error("redis down"));

    await expect(controller.enqueue(validBody())).rejects.toThrow("redis down");
    expect(logger.error).toHaveBeenCalledWith(
      "internal_grading.enqueue.failed",
      expect.objectContaining({
        grading_job_id: "job-new",
        error: "redis down",
      }),
    );
  });

  it("refuses author-only fields in the update", async () => {
    const { controller, attemptService, killSwitch } = makeController();
    const body = validBody();
    body.updateDto.authorQuestions = [];

    await expect(controller.enqueue(body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(killSwitch.assertGradingAllowed).not.toHaveBeenCalled();
    expect(attemptService.createGradingJob).not.toHaveBeenCalled();
  });
});

describe("InternalGradingController.activeJob", () => {
  it("returns the in-flight job id looked up by the shared grading key", async () => {
    const { controller, jobStateService } = makeController();
    jobStateService.findActiveJob.mockResolvedValue({ id: "job-running" });

    await expect(
      controller.activeJob({
        userId: "learner@example.com",
        assignmentId: 7,
        attemptId: 42,
      }),
    ).resolves.toEqual({ gradingJobId: "job-running" });
    expect(jobStateService.findActiveJob).toHaveBeenCalledWith(
      "grading:learner@example.com:7:42",
    );
  });

  it("returns null when nothing is grading", async () => {
    const { controller } = makeController();

    await expect(
      controller.activeJob({
        userId: "learner@example.com",
        assignmentId: 7,
        attemptId: 42,
      }),
    ).resolves.toEqual({ gradingJobId: null });
  });
});

describe("internal grading request validation", () => {
  // Same options as the global pipe in main.ts.
  const pipe = new ValidationPipe({ whitelist: true });
  const bodyMeta: ArgumentMetadata = {
    type: "body",
    metatype: InternalGradingEnqueueRequestDto,
  };
  const queryMeta: ArgumentMetadata = {
    type: "query",
    metatype: InternalGradingActiveJobQueryDto,
  };

  it("accepts a valid enqueue body and strips unknown keys", async () => {
    const result = (await pipe.transform(
      {
        ...validBody(),
        isAdmin: true,
        updateDto: {
          ...validBody().updateDto,
          responsesForQuestions: [{ id: 3, learnerTextResponse: "a", x: 1 }],
        },
      },
      bodyMeta,
    )) as Record<string, unknown>;

    expect(result).not.toHaveProperty("isAdmin");
    expect(result.updateDto).toEqual({
      submitted: true,
      responsesForQuestions: [{ id: 3, learnerTextResponse: "a" }],
      language: "en",
    });
  });

  it.each([
    ["non-positive assignment id", { assignmentId: 0 }],
    ["string attempt id", { attemptId: "42" }],
    ["id past int4", { attemptId: 2_147_483_648 }],
    ["empty user id", { userId: "" }],
    ["string callback flag", { gradingCallbackRequired: "true" }],
    ["non-ISO received time", { submissionReceivedAt: "yesterday" }],
    ["inline tier", { tier: "inline" }],
    ["missing update", { updateDto: undefined }],
    [
      "unsubmitted update",
      { updateDto: { submitted: false, responsesForQuestions: [] } },
    ],
  ])("rejects %s", async (_label, override) => {
    await expect(
      pipe.transform({ ...validBody(), ...override }, bodyMeta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("coerces numeric query ids", async () => {
    await expect(
      pipe.transform(
        { userId: "learner@example.com", assignmentId: "7", attemptId: "42" },
        queryMeta,
      ),
    ).resolves.toEqual({
      userId: "learner@example.com",
      assignmentId: 7,
      attemptId: 42,
    });
  });

  it.each([
    ["missing user", { assignmentId: "7", attemptId: "42" }],
    ["non-numeric id", { userId: "u", assignmentId: "7x", attemptId: "42" }],
    ["fractional id", { userId: "u", assignmentId: "7.5", attemptId: "42" }],
    [
      "repeated user",
      { userId: ["a", "b"], assignmentId: "7", attemptId: "1" },
    ],
  ])("rejects a query with %s", async (_label, query) => {
    await expect(pipe.transform(query, queryMeta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
