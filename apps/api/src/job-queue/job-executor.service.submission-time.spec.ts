import { JobExecutorService } from "./job-executor.service";
import { JOB_NAMES } from "./job-queue.constants";

type ExecutorInternals = {
  executeAttemptJob: (jobName: string, payload: unknown) => Promise<void>;
  attemptService: { processGradingJob: jest.Mock };
};

const buildExecutor = () => {
  const service = Object.create(
    JobExecutorService.prototype,
  ) as unknown as ExecutorInternals;
  service.attemptService = {
    processGradingJob: jest.fn().mockResolvedValue(undefined),
  };
  return service;
};

const basePayload = {
  gradingJobId: "job-1",
  attemptId: 1873208,
  assignmentId: 771,
  updateDto: { submitted: true, responsesForQuestions: [] },
  userSession: {
    userId: "learner@example.com",
    role: "learner",
    gradingCallbackRequired: false,
  },
};

describe("JobExecutorService attempt grading receive time", () => {
  it("hands the server receive time from the job to grading", async () => {
    const executor = buildExecutor();

    await executor.executeAttemptJob(JOB_NAMES.ATTEMPT_GRADE, {
      ...basePayload,
      submissionReceivedAt: "2026-10-21T01:16:15.160Z",
    });

    const call = executor.attemptService.processGradingJob.mock.calls[0];
    expect(call[6]).toEqual(new Date("2026-10-21T01:16:15.160Z"));
  });

  it("falls back to grading time for a job queued without one", async () => {
    const executor = buildExecutor();

    await executor.executeAttemptJob(JOB_NAMES.ATTEMPT_GRADE, basePayload);

    const call = executor.attemptService.processGradingJob.mock.calls[0];
    expect(call[6]).toBeUndefined();
  });

  it("ignores a receive time that does not parse", async () => {
    const executor = buildExecutor();

    await executor.executeAttemptJob(JOB_NAMES.ATTEMPT_GRADE, {
      ...basePayload,
      submissionReceivedAt: "not a date",
    });

    const call = executor.attemptService.processGradingJob.mock.calls[0];
    expect(call[6]).toBeUndefined();
  });
});
