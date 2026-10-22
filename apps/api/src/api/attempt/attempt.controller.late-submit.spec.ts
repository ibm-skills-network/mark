import { UserRole } from "../../auth/interfaces/user.session.interface";
import { AttemptClosedException } from "../assignment/attempt/helper/submission-deadline.helper";
import { AttemptControllerV2 } from "./attempt.controller";

const logger = {
  child: () => logger,
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const buildController = () => {
  const attemptService = {
    assertLearnerAttemptOpenForSubmit: jest.fn().mockResolvedValue(undefined),
    classifyLearnerAttemptTier: jest.fn().mockResolvedValue("standard"),
    createGradingJob: jest.fn().mockResolvedValue({
      gradingJobId: "job-1",
      message: "created",
      queueName: "mark.attempt",
    }),
    enqueueGradingJob: jest.fn().mockResolvedValue(undefined),
    createAuthorGradingJob: jest.fn().mockResolvedValue({
      gradingJobId: "job-author",
      message: "created",
      queueName: "mark.attempt",
    }),
    enqueueAuthorPreviewJob: jest.fn().mockResolvedValue(undefined),
    updateAssignmentAttempt: jest.fn().mockResolvedValue({ id: 1873208 }),
    getAttemptSubmissionStatus: jest.fn(),
  };
  const killSwitch = { assertGradingAllowed: jest.fn() };
  const controller = new AttemptControllerV2(
    logger as never,
    attemptService as never,
    {} as never,
    {} as never,
    {} as never,
    killSwitch as never,
  );
  return { controller, attemptService, killSwitch };
};

const learnerRequest = (role = UserRole.LEARNER) =>
  ({
    userSession: {
      userId: "learner@example.com",
      role,
      gradingCallbackRequired: false,
    },
    cookies: {},
  }) as never;

const body = { submitted: true, responsesForQuestions: [] } as never;

describe("AttemptControllerV2 submit on a closed attempt", () => {
  it("rejects a resubmit synchronously, before anything is queued", async () => {
    const { controller, attemptService, killSwitch } = buildController();
    attemptService.assertLearnerAttemptOpenForSubmit.mockRejectedValue(
      new AttemptClosedException(1873208, "time_limit"),
    );

    const error: unknown = await controller
      .updateAssignmentAttempt(1873208, 771, body, learnerRequest())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AttemptClosedException);
    expect((error as AttemptClosedException).getStatus()).toBe(409);
    expect(attemptService.createGradingJob).not.toHaveBeenCalled();
    expect(attemptService.enqueueGradingJob).not.toHaveBeenCalled();
    expect(attemptService.updateAssignmentAttempt).not.toHaveBeenCalled();
    // A closed attempt says so even while AI grading is paused.
    expect(killSwitch.assertGradingAllowed).not.toHaveBeenCalled();
  });

  it("stamps the receive time on the queued job", async () => {
    const { controller, attemptService } = buildController();
    const before = Date.now();

    await controller.updateAssignmentAttempt(
      1873208,
      771,
      body,
      learnerRequest(),
    );

    const [attemptId, receivedAt] =
      attemptService.assertLearnerAttemptOpenForSubmit.mock.calls[0];
    expect(attemptId).toBe(1873208);
    expect(receivedAt).toBeInstanceOf(Date);
    expect((receivedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    const enqueueArgs = attemptService.enqueueGradingJob.mock.calls[0];
    expect(enqueueArgs[7]).toBe(receivedAt);
  });

  it("passes the receive time to an inline grade", async () => {
    const { controller, attemptService } = buildController();
    attemptService.classifyLearnerAttemptTier.mockResolvedValue("inline");

    await controller.updateAssignmentAttempt(
      1873208,
      771,
      body,
      learnerRequest(),
    );

    const [, receivedAt] =
      attemptService.assertLearnerAttemptOpenForSubmit.mock.calls[0];
    const inlineArgs = attemptService.updateAssignmentAttempt.mock.calls[0];
    expect(inlineArgs[6]).toBe(receivedAt);
  });

  it("does not run the learner deadline check on an author preview", async () => {
    const { controller, attemptService } = buildController();

    await controller.updateAssignmentAttempt(
      -1,
      771,
      body,
      learnerRequest(UserRole.AUTHOR),
    );

    expect(
      attemptService.assertLearnerAttemptOpenForSubmit,
    ).not.toHaveBeenCalled();
  });
});

describe("AttemptControllerV2 submission status", () => {
  it("returns the attempt's submission status", async () => {
    const { controller, attemptService } = buildController();
    const status = {
      id: 1873208,
      submitted: true,
      closedAtTimeLimit: true,
      acceptingSubmissions: false,
      expiresAt: "2026-10-21T01:16:03.499Z",
      serverNow: "2026-10-21T01:16:24.000Z",
    };
    attemptService.getAttemptSubmissionStatus.mockResolvedValue(status);

    await expect(
      controller.getAttemptSubmissionStatus(1873208, learnerRequest()),
    ).resolves.toEqual(status);
    expect(attemptService.getAttemptSubmissionStatus).toHaveBeenCalledWith(
      1873208,
    );
  });
});
