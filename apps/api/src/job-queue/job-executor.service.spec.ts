import { JobExecutorService } from "./job-executor.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "./job-queue.constants";

describe("JobExecutorService translation jobs", () => {
  const makeExecutor = () => {
    const translationService = {
      translateQuestion: jest.fn().mockResolvedValue({
        inserted: 0,
        skipped: 0,
        failed: 0,
      }),
      translateVariant: jest.fn().mockResolvedValue({
        inserted: 0,
        skipped: 0,
        failed: 0,
      }),
      translateAssignment: jest.fn().mockResolvedValue({
        inserted: 0,
        skipped: 0,
        failed: 0,
      }),
      markPublishTranslationFailed: jest.fn().mockResolvedValue(undefined),
      rollbackOneInflightSeed: jest.fn().mockResolvedValue(undefined),
    };
    const logger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
    };
    const noopService = {};

    return {
      executor: new JobExecutorService(
        noopService as never,
        noopService as never,
        noopService as never,
        noopService as never,
        noopService as never,
        translationService as never,
        logger as never,
      ),
      translationService,
    };
  };

  it("keeps legacy question payloads force-retranslating when the flag is absent", async () => {
    const { executor, translationService } = makeExecutor();
    const question = { question: "updated content" };

    await executor.executeJob({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
      jobName: JOB_NAMES.TRANSLATE_QUESTION,
      payload: {
        parentJobId: "publish:v2:7",
        assignmentId: 7,
        questionId: 42,
        question,
      },
    });

    expect(translationService.translateQuestion).toHaveBeenCalledWith(
      7,
      42,
      question,
      "publish:v2:7",
      true,
      true,
    );
  });

  it("keeps legacy variant payloads force-retranslating when the flag is absent", async () => {
    const { executor, translationService } = makeExecutor();
    const variant = { variantContent: "updated content" };

    await executor.executeJob({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
      jobName: JOB_NAMES.TRANSLATE_VARIANT,
      payload: {
        parentJobId: "publish:v2:7",
        assignmentId: 7,
        questionId: 42,
        variantId: 99,
        variant,
      },
    });

    expect(translationService.translateVariant).toHaveBeenCalledWith(
      7,
      42,
      99,
      variant,
      "publish:v2:7",
      true,
      true,
    );
  });

  it("marks final failed translation attempts and releases the in-flight seed", async () => {
    const { executor, translationService } = makeExecutor();
    translationService.translateQuestion.mockRejectedValueOnce(
      new Error("llm unavailable"),
    );

    await expect(
      executor.executeJob({
        queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        jobName: JOB_NAMES.TRANSLATE_QUESTION,
        attemptsMade: 2,
        maxAttempts: 3,
        payload: {
          parentJobId: "publish:v2:7",
          assignmentId: 7,
          questionId: 42,
          question: { question: "content" },
        },
      }),
    ).rejects.toThrow("llm unavailable");

    expect(
      translationService.markPublishTranslationFailed,
    ).toHaveBeenCalledWith("publish:v2:7", "question", 42);
    expect(translationService.rollbackOneInflightSeed).toHaveBeenCalledWith(7);
  });

  it("leaves non-final failed translation attempts in flight for BullMQ retry", async () => {
    const { executor, translationService } = makeExecutor();
    translationService.translateQuestion.mockRejectedValueOnce(
      new Error("transient llm error"),
    );

    await expect(
      executor.executeJob({
        queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        jobName: JOB_NAMES.TRANSLATE_QUESTION,
        attemptsMade: 1,
        maxAttempts: 3,
        payload: {
          parentJobId: "publish:v2:7",
          assignmentId: 7,
          questionId: 42,
          question: { question: "content" },
        },
      }),
    ).rejects.toThrow("transient llm error");

    expect(
      translationService.markPublishTranslationFailed,
    ).not.toHaveBeenCalled();
    expect(translationService.rollbackOneInflightSeed).not.toHaveBeenCalled();
  });
});
