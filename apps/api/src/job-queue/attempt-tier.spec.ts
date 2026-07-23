import { QuestionType } from "@prisma/client";
import { attemptQueueForTier, classifyAttemptTier } from "./attempt-tier";
import { JOB_QUEUE_NAMES } from "./job-queue.constants";

describe("classifyAttemptTier", () => {
  it("classifies deterministic-only attempts as inline", () => {
    expect(
      classifyAttemptTier([
        QuestionType.SINGLE_CORRECT,
        QuestionType.MULTIPLE_CORRECT,
        QuestionType.TRUE_FALSE,
      ]),
    ).toBe("inline");
  });

  it("classifies any file/upload question as heavy", () => {
    expect(
      classifyAttemptTier([QuestionType.SINGLE_CORRECT, QuestionType.UPLOAD]),
    ).toBe("heavy");
    expect(classifyAttemptTier([QuestionType.LINK_FILE])).toBe("heavy");
  });

  it("heavy wins over text when both are present", () => {
    expect(classifyAttemptTier([QuestionType.TEXT, QuestionType.UPLOAD])).toBe(
      "heavy",
    );
  });

  it("classifies text and URL questions as standard", () => {
    expect(classifyAttemptTier([QuestionType.TEXT])).toBe("standard");
    expect(classifyAttemptTier([QuestionType.URL])).toBe("standard");
    expect(
      classifyAttemptTier([QuestionType.TEXT, QuestionType.TRUE_FALSE]),
    ).toBe("standard");
  });

  it("falls back to standard for an empty question list", () => {
    expect(classifyAttemptTier([])).toBe("standard");
  });
});

describe("attemptQueueForTier", () => {
  it("maps heavy to the heavy queue and standard to the default queue", () => {
    expect(attemptQueueForTier("heavy")).toBe(JOB_QUEUE_NAMES.ATTEMPT_HEAVY);
    expect(attemptQueueForTier("standard")).toBe(JOB_QUEUE_NAMES.ATTEMPT);
  });
});
