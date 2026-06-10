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
      warn: jest.fn(),
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

  it("throws on partial language failure while attempts remain so BullMQ retries", async () => {
    const { executor, translationService } = makeExecutor();
    translationService.translateQuestion.mockResolvedValueOnce({
      inserted: 22,
      skipped: 0,
      failed: 1,
    });

    await expect(
      executor.executeJob({
        queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        jobName: JOB_NAMES.TRANSLATE_QUESTION,
        attemptsMade: 0,
        maxAttempts: 3,
        payload: {
          parentJobId: "publish:v2:7",
          assignmentId: 7,
          questionId: 42,
          question: { question: "content" },
        },
      }),
    ).rejects.toThrow(/1 language/);

    expect(
      translationService.markPublishTranslationFailed,
    ).not.toHaveBeenCalled();
    expect(translationService.rollbackOneInflightSeed).not.toHaveBeenCalled();
  });

  it("completes without throwing when languages fail on the final attempt", async () => {
    const { executor, translationService } = makeExecutor();
    translationService.translateQuestion.mockResolvedValueOnce({
      inserted: 22,
      skipped: 0,
      failed: 1,
    });

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
    ).resolves.toBeUndefined();

    expect(
      translationService.markPublishTranslationFailed,
    ).not.toHaveBeenCalled();
  });

  it("drops forceRetranslation on retry attempts so completed languages are kept", async () => {
    const { executor, translationService } = makeExecutor();
    const question = { question: "content" };

    await executor.executeJob({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
      jobName: JOB_NAMES.TRANSLATE_QUESTION,
      attemptsMade: 1,
      maxAttempts: 3,
      payload: {
        parentJobId: "publish:v2:7",
        assignmentId: 7,
        questionId: 42,
        question,
        forceRetranslation: true,
      },
    });

    expect(translationService.translateQuestion).toHaveBeenCalledWith(
      7,
      42,
      question,
      "publish:v2:7",
      false,
      false,
    );
  });

  it("throws on partial variant language failure while attempts remain", async () => {
    const { executor, translationService } = makeExecutor();
    translationService.translateVariant.mockResolvedValueOnce({
      inserted: 21,
      skipped: 0,
      failed: 2,
    });

    await expect(
      executor.executeJob({
        queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        jobName: JOB_NAMES.TRANSLATE_VARIANT,
        attemptsMade: 0,
        maxAttempts: 3,
        payload: {
          parentJobId: "publish:v2:7",
          assignmentId: 7,
          questionId: 42,
          variantId: 99,
          variant: { variantContent: "content" },
        },
      }),
    ).rejects.toThrow(/2 language/);
  });

  it("throws on partial meta language failure while attempts remain", async () => {
    const { executor, translationService } = makeExecutor();
    translationService.translateAssignment.mockResolvedValueOnce({
      inserted: 22,
      skipped: 0,
      failed: 1,
    });

    await expect(
      executor.executeJob({
        queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        jobName: JOB_NAMES.TRANSLATE_META,
        attemptsMade: 0,
        maxAttempts: 3,
        payload: {
          parentJobId: "publish:v2:7",
          assignmentId: 7,
        },
      }),
    ).rejects.toThrow(/1 language/);
  });
});
