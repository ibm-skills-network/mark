import {
  PresentationStageError,
  logPresentationFailure,
  presentationErrorMessage,
  resolveVideoDuration,
  runPresentationStage,
} from "../presentation-processing";

describe("runPresentationStage", () => {
  it("returns the value of the operation", async () => {
    await expect(
      runPresentationStage("transcription", () => Promise.resolve("done")),
    ).resolves.toBe("done");
  });

  it("tags a thrown error with the stage it failed in and keeps the cause", async () => {
    const cause = new TypeError(
      "Cannot read properties of undefined (reading 'buffer')",
    );

    const error = await runPresentationStage("audio-extraction", () =>
      Promise.reject(cause),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PresentationStageError);
    expect((error as PresentationStageError).stage).toBe("audio-extraction");
    expect((error as PresentationStageError).cause).toBe(cause);
  });

  it("keeps the original stage when a stage error passes through an outer stage", async () => {
    const inner = new PresentationStageError("transcription", "boom");

    const error = await runPresentationStage("audio-extraction", () =>
      Promise.reject(inner),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBe(inner);
  });

  it("gives up on an operation that never settles", async () => {
    const error = await runPresentationStage(
      "video-tools",
      () => new Promise(() => undefined),
      {
        timeoutMs: 20,
      },
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PresentationStageError);
    expect((error as PresentationStageError).stage).toBe("video-tools");
    expect((error as PresentationStageError).message).toMatch(/timed out/i);
  });

  it("does not time out an operation that finishes in time", async () => {
    await expect(
      runPresentationStage("video-tools", () => Promise.resolve(1), {
        timeoutMs: 5000,
      }),
    ).resolves.toBe(1);
  });
});

describe("presentationErrorMessage", () => {
  it("explains which stage failed", () => {
    expect(
      presentationErrorMessage(new PresentationStageError("video-tools", "x")),
    ).toMatch(/video tools/i);
    expect(
      presentationErrorMessage(
        new PresentationStageError("audio-extraction", "x"),
      ),
    ).toMatch(/audio/i);
    expect(
      presentationErrorMessage(
        new PresentationStageError("transcription", "x"),
      ),
    ).toMatch(/transcribe/i);
    expect(
      presentationErrorMessage(
        new PresentationStageError("body-language", "x"),
      ),
    ).toMatch(/video/i);
    expect(
      presentationErrorMessage(
        new PresentationStageError("coach-feedback", "x"),
      ),
    ).toMatch(/feedback/i);
  });

  it("gives every stage a distinct message", () => {
    const stages = [
      "video-tools",
      "audio-extraction",
      "transcription",
      "body-language",
      "coach-feedback",
    ] as const;
    const messages = stages.map((stage) =>
      presentationErrorMessage(new PresentationStageError(stage, "x")),
    );

    expect(new Set(messages).size).toBe(stages.length);
  });

  it("falls back to a generic message for an unknown failure", () => {
    expect(presentationErrorMessage(new Error("something else"))).toMatch(
      /recording/i,
    );
  });
});

describe("logPresentationFailure", () => {
  it("logs the real error with the stage and the ids, and no payload", () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const cause = new TypeError(
      "Cannot read properties of undefined (reading 'buffer')",
    );

    logPresentationFailure(
      new PresentationStageError("audio-extraction", "extract failed", {
        cause,
      }),
      {
        assignmentId: 2209,
        questionId: 6493,
      },
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const [event, context] = consoleError.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(event).toBe("presentation.processing.failed");
    expect(context).toMatchObject({
      stage: "audio-extraction",
      assignmentId: 2209,
      questionId: 6493,
      errorName: "TypeError",
      errorMessage: "Cannot read properties of undefined (reading 'buffer')",
    });

    consoleError.mockRestore();
  });

  it("still reports a failure that is not an Error", () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logPresentationFailure("just a string", { assignmentId: 1, questionId: 2 });

    const [, context] = consoleError.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(context).toMatchObject({
      stage: "unknown",
      errorMessage: "just a string",
    });

    consoleError.mockRestore();
  });
});

describe("resolveVideoDuration", () => {
  it("returns the duration once the browser knows it", async () => {
    await expect(
      resolveVideoDuration(
        { duration: 42 },
        { fallbackSeconds: 60, delayMs: 1 },
      ),
    ).resolves.toBe(42);
  });

  it("waits for a duration that arrives late", async () => {
    const video = { duration: Number.NaN };
    setTimeout(() => {
      video.duration = 12;
    }, 5);

    await expect(
      resolveVideoDuration(video, {
        fallbackSeconds: 60,
        delayMs: 1,
        attempts: 50,
      }),
    ).resolves.toBe(12);
  });

  it("falls back instead of waiting forever on a recording with no duration", async () => {
    const attempts = 5;
    const delayMs = 1;
    const sleep = jest.fn().mockResolvedValue(undefined);

    const duration = await resolveVideoDuration(
      { duration: Number.POSITIVE_INFINITY },
      { fallbackSeconds: 90, attempts, delayMs, sleep },
    );

    expect(duration).toBe(90);
    expect(sleep).toHaveBeenCalledTimes(attempts);
  });
});
