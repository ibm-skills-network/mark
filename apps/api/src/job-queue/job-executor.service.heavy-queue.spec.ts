import { JobExecutorService } from "./job-executor.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "./job-queue.constants";

type ExecutorInternals = {
  executeAttemptJob: (jobName: string, payload: unknown) => Promise<void>;
};

describe("JobExecutorService heavy attempt queue dispatch", () => {
  it("routes mark.attempt.heavy to the attempt job handler", async () => {
    const service = Object.create(
      JobExecutorService.prototype,
    ) as JobExecutorService;
    const attemptSpy = jest
      .spyOn(service as unknown as ExecutorInternals, "executeAttemptJob")
      .mockResolvedValue(undefined);

    await service.executeJob({
      queueName: JOB_QUEUE_NAMES.ATTEMPT_HEAVY,
      jobName: JOB_NAMES.ATTEMPT_GRADE,
      payload: { attemptId: 1 },
      bullJobId: "job-1",
    });

    expect(attemptSpy).toHaveBeenCalledWith(JOB_NAMES.ATTEMPT_GRADE, {
      attemptId: 1,
    });
  });
});
