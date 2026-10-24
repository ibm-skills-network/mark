import { ValidationPipe } from "@nestjs/common";
import { LearnerUpdateAssignmentAttemptRequestDto } from "./create.update.assignment.attempt.request.dto";

// The same pipe main.ts installs globally.
const pipe = new ValidationPipe({ whitelist: true });

const validate = (body: unknown) =>
  pipe.transform(body, {
    type: "body",
    metatype: LearnerUpdateAssignmentAttemptRequestDto,
  }) as Promise<{ responsesForQuestions: Record<string, unknown>[] }>;

// What the web client sends for an untouched question.
const unanswered = (id: number) => ({
  id,
  learnerTextResponse: "",
  learnerUrlResponse: "",
  learnerChoices: [],
  learnerAnswerChoice: null,
  learnerFileResponse: [],
  learnerPresentationResponse: null,
});

const submitOf = (...responsesForQuestions: unknown[]) => ({
  submitted: true,
  responsesForQuestions,
  language: "en",
});

const storedFile = {
  filename: "report.pdf",
  key: "7/learner@example.com/3/abc-report.pdf",
  bucket: "learner-bucket",
  fileType: "application/pdf",
  content: "InCos",
};

describe("LearnerUpdateAssignmentAttemptRequestDto", () => {
  it("accepts the web client's empty answers", async () => {
    await expect(
      validate(submitOf(unanswered(1), unanswered(2))),
    ).resolves.toBeDefined();
  });

  it("accepts a full answer", async () => {
    await expect(
      validate(
        submitOf({
          id: 3,
          learnerTextResponse: "<p>An essay</p>",
          learnerUrlResponse: "https://example.com",
          learnerChoices: ["A", "B"],
          learnerAnswerChoice: true,
          learnerFileResponse: [storedFile],
          learnerPresentationResponse: null,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("strips keys an answer does not declare", async () => {
    const result = await validate(
      submitOf({ ...unanswered(1), question: "ignored", points: 99 }),
    );

    expect(result.responsesForQuestions[0]).not.toHaveProperty("question");
    expect(result.responsesForQuestions[0]).not.toHaveProperty("points");
  });

  it("keeps submitted: true required", async () => {
    await expect(
      validate({ submitted: false, responsesForQuestions: [] }),
    ).rejects.toThrow();
  });

  it.each([
    ["a non-integer id", { ...unanswered(1), id: 1.5 }],
    ["a zero id", { ...unanswered(1), id: 0 }],
    ["a string id", { ...unanswered(1), id: "1" }],
    [
      "text over 200000 characters",
      { ...unanswered(1), learnerTextResponse: "x".repeat(200_001) },
    ],
    [
      "a URL over 2048 characters",
      { ...unanswered(1), learnerUrlResponse: "x".repeat(2049) },
    ],
    [
      "more than 50 choices",
      { ...unanswered(1), learnerChoices: Array.from({ length: 51 }, String) },
    ],
    [
      "a choice over 5000 characters",
      { ...unanswered(1), learnerChoices: ["x".repeat(5001)] },
    ],
    ["a non-string choice", { ...unanswered(1), learnerChoices: [1] }],
    [
      "a non-boolean true/false answer",
      { ...unanswered(1), learnerAnswerChoice: "true" },
    ],
    [
      "more than 20 files",
      {
        ...unanswered(1),
        learnerFileResponse: Array.from({ length: 21 }, () => storedFile),
      },
    ],
    [
      "a file name over 255 characters",
      {
        ...unanswered(1),
        learnerFileResponse: [{ ...storedFile, filename: "x".repeat(256) }],
      },
    ],
    [
      "a file without its storage key",
      {
        ...unanswered(1),
        learnerFileResponse: [{ filename: "a.pdf", bucket: "learner-bucket" }],
      },
    ],
    [
      "a file with a repository link",
      {
        ...unanswered(1),
        learnerFileResponse: [
          { ...storedFile, githubUrl: "https://github.com/o/r/blob/main/a" },
        ],
      },
    ],
    [
      "a file with inline image data",
      {
        ...unanswered(1),
        learnerFileResponse: [{ ...storedFile, imageData: "data:image/png" }],
      },
    ],
    [
      "a presentation answer",
      { ...unanswered(1), learnerPresentationResponse: { transcript: "hi" } },
    ],
  ])("rejects %s", async (_label, item) => {
    await expect(validate(submitOf(item))).rejects.toThrow();
  });

  it("rejects more than 200 answers", async () => {
    await expect(
      validate(
        submitOf(
          ...Array.from({ length: 201 }, (_, index) => unanswered(index + 1)),
        ),
      ),
    ).rejects.toThrow();
  });
});
