import { GradingContractError } from "backend-contracts";
import { JobExecutorService } from "./job-executor.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "./job-queue.constants";

describe("learner grading contract at executor boundary", () => {
  const makeExecutor = () => {
    const attempt = { processGradingJob: jest.fn() };
    const logger = { child: jest.fn().mockReturnThis() };
    return {
      attempt,
      executor: new JobExecutorService(
        {} as never,
        {} as never,
        {} as never,
        attempt as never,
        {} as never,
        {} as never,
        logger as never,
      ),
    };
  };
  const payload = () => ({
    gradingJobId: "run-1",
    attemptId: 1,
    assignmentId: 2,
    updateDto: {
      submitted: true,
      responsesForQuestions: [{ id: 3, learnerAnswerChoice: false }],
    },
    userSession: { userId: "learner-1", role: "learner" },
  });
  it.each([JOB_QUEUE_NAMES.ATTEMPT, JOB_QUEUE_NAMES.ATTEMPT_HEAVY])(
    "accepts legacy and v1 JSON on %s",
    async (queueName) => {
      for (const data of [payload(), { ...payload(), schemaVersion: 1 }]) {
        const { attempt, executor } = makeExecutor();
        await executor.executeJob({
          queueName,
          jobName: JOB_NAMES.ATTEMPT_GRADE,
          payload: JSON.parse(JSON.stringify(data)),
        });
        expect(attempt.processGradingJob).toHaveBeenCalledWith(
          "run-1",
          1,
          2,
          data.updateDto,
          "",
          { userSession: data.userSession },
        );
      }
    },
  );
  it.each([
    null,
    {},
    { ...payload(), schemaVersion: 2 },
    { ...payload(), attemptId: "1" },
    {
      ...payload(),
      updateDto: {
        submitted: true,
        responsesForQuestions: [{ id: 1 }, { id: 1 }],
      },
    },
  ])("rejects malformed jobs before grading or persistence", async (data) => {
    const { attempt, executor } = makeExecutor();
    await expect(
      executor.executeJob({
        queueName: JOB_QUEUE_NAMES.ATTEMPT,
        jobName: JOB_NAMES.ATTEMPT_GRADE,
        payload: data,
      }),
    ).rejects.toBeInstanceOf(GradingContractError);
    expect(attempt.processGradingJob).not.toHaveBeenCalled();
  });
});
