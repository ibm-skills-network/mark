/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useAutoSaveResponse } from "../use-auto-save-response";
import { useLearnerStore } from "@/stores/learner";
import { submitQuestion } from "@/lib/talkToBackend";
import { toast } from "sonner";

jest.mock("@/lib/talkToBackend");
jest.mock("@/stores/learner");
jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe("useAutoSaveResponse", () => {
  const mockSubmitQuestion = submitQuestion as jest.MockedFunction<
    typeof submitQuestion
  >;

  const mockStoreWithQuestion = (
    questionId: number,
    questionData: Partial<any>,
  ) => {
    (useLearnerStore as unknown as jest.Mock).mockImplementation((selector) => {
      const mockState = {
        questions: [
          {
            id: questionId,
            learnerTextResponse: "",
            learnerUrlResponse: "",
            learnerChoices: [],
            learnerAnswerChoice: null,
            learnerFileResponse: [],
            presentationResponse: null,
            selectedLanguage: "en",
            ...questionData,
          },
        ],
        userPreferedLanguage: "en",
      };
      return selector(mockState);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    (useLearnerStore as unknown as jest.Mock).mockImplementation((selector) => {
      const mockState = {
        questions: [
          {
            id: 1,
            learnerTextResponse: "",
            learnerUrlResponse: "",
            learnerChoices: [],
            learnerAnswerChoice: null,
            learnerFileResponse: [],
            presentationResponse: null,
            selectedLanguage: "en",
          },
        ],
        userPreferedLanguage: "en",
      };
      return selector(mockState);
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("should auto-save after debounce period", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({ ok: true, data: {} as any });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 3000,
      }),
    );

    mockStoreWithQuestion(questionId, {
      learnerTextResponse: "Test answer",
    });

    rerender();

    expect(mockSubmitQuestion).not.toHaveBeenCalled();

    jest.advanceTimersByTime(3000);

    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenCalledWith(
        assignmentId,
        attemptId,
        questionId,
        expect.objectContaining({
          learnerTextResponse: "Test answer",
        }),
      );
    });
  });

  it("should not save if data has not changed", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({ ok: true, data: {} as any });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 1000,
      }),
    );

    rerender();
    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(mockSubmitQuestion).not.toHaveBeenCalled();
    });
  });

  it("should cancel previous save when data changes rapidly", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({ ok: true, data: {} as any });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 3000,
      }),
    );

    (useLearnerStore as unknown as jest.Mock).mockReturnValue({
      id: 789,
      learnerTextResponse: "First change",
    });
    rerender();

    jest.advanceTimersByTime(1500);

    (useLearnerStore as unknown as jest.Mock).mockReturnValue({
      id: 789,
      learnerTextResponse: "Second change",
    });
    rerender();

    jest.advanceTimersByTime(3000);

    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenCalledTimes(1);
      expect(mockSubmitQuestion).toHaveBeenCalledWith(
        assignmentId,
        attemptId,
        questionId,
        expect.objectContaining({
          learnerTextResponse: "Second change",
        }),
      );
    });
  });

  it("should not save when disabled", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({ ok: true, data: {} as any });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: false,
        debounceMs: 1000,
      }),
    );

    (useLearnerStore as unknown as jest.Mock).mockReturnValue({
      id: 789,
      learnerTextResponse: "Test answer",
    });
    rerender();

    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(mockSubmitQuestion).not.toHaveBeenCalled();
    });
  });

  it("should not save when assignmentId or attemptId is null", async () => {
    mockSubmitQuestion.mockResolvedValue({ ok: true, data: {} as any });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(null, null, 789, {
        enabled: true,
        debounceMs: 1000,
      }),
    );

    (useLearnerStore as unknown as jest.Mock).mockReturnValue({
      id: 789,
      learnerTextResponse: "Test answer",
    });
    rerender();

    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(mockSubmitQuestion).not.toHaveBeenCalled();
    });
  });

  it("should support immediate save via saveNow", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({ ok: true, data: {} as any });

    (useLearnerStore as unknown as jest.Mock).mockReturnValue({
      id: 789,
      learnerTextResponse: "Immediate save",
    });

    const { result } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 3000,
      }),
    );

    result.current.saveNow();

    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenCalledWith(
        assignmentId,
        attemptId,
        questionId,
        expect.objectContaining({
          learnerTextResponse: "Immediate save",
        }),
      );
    });

    expect(mockSubmitQuestion).toHaveBeenCalledTimes(1);
  });

  it("should cleanup timers on unmount", () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

    mockStoreWithQuestion(questionId, {
      learnerTextResponse: "Test",
    });

    const { unmount, rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 3000,
      }),
    );

    rerender();

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("should save choice-based responses", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({ ok: true, data: {} as any });

    let selectedIndices: number[] | undefined = undefined;

    (useLearnerStore as unknown as jest.Mock).mockImplementation((selector) => {
      const mockState = {
        questions:
          selectedIndices !== undefined
            ? [
                {
                  id: questionId,
                  learnerTextResponse: "",
                  learnerUrlResponse: "",
                  learnerChoices: selectedIndices,
                  learnerAnswerChoice: null,
                  learnerFileResponse: [],
                  presentationResponse: null,
                  selectedLanguage: "en",
                  choices: [
                    { choice: "Choice A" },
                    { choice: "Choice B" },
                    { choice: "Choice C" },
                  ],
                },
              ]
            : [],
        userPreferedLanguage: "en",
      };
      return selector(mockState);
    });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 500,
      }),
    );

    selectedIndices = [1, 2];
    rerender();

    await waitFor(() => {
      jest.advanceTimersByTime(500);
      expect(mockSubmitQuestion).toHaveBeenCalled();
    });

    expect(mockSubmitQuestion).toHaveBeenCalledWith(
      assignmentId,
      attemptId,
      questionId,
      expect.objectContaining({
        learnerChoices: ["Choice B", "Choice C"],
      }),
    );
  });

  it("should save true/false responses", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({ ok: true, data: {} as any });

    (useLearnerStore as unknown as jest.Mock).mockImplementation((selector) => {
      const mockState = {
        questions: [
          {
            id: questionId,
            learnerTextResponse: "",
            learnerUrlResponse: "",
            learnerChoices: [],
            learnerAnswerChoice: true,
            learnerFileResponse: [],
            presentationResponse: null,
            selectedLanguage: "en",
          },
        ],
        userPreferedLanguage: "en",
      };
      return selector(mockState);
    });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 500,
      }),
    );

    rerender();
    jest.advanceTimersByTime(500);

    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenCalledWith(
        assignmentId,
        attemptId,
        questionId,
        expect.objectContaining({
          learnerAnswerChoice: true,
        }),
      );
    });
  });

  it("should prevent concurrent saves", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    let resolveFirstSave: () => void;
    const firstSavePromise = new Promise((resolve) => {
      resolveFirstSave = () => resolve({ ok: true, data: {} as any });
    });

    mockSubmitQuestion
      .mockReturnValueOnce(firstSavePromise as any)
      .mockResolvedValue({ ok: true, data: {} as any });

    (useLearnerStore as unknown as jest.Mock).mockImplementation((selector) => {
      const mockState = {
        questions: [
          {
            id: questionId,
            learnerTextResponse: "Test",
            learnerUrlResponse: "",
            learnerChoices: [],
            learnerAnswerChoice: null,
            learnerFileResponse: [],
            presentationResponse: null,
            selectedLanguage: "en",
          },
        ],
        userPreferedLanguage: "en",
      };
      return selector(mockState);
    });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 100,
      }),
    );

    rerender();
    jest.advanceTimersByTime(100);

    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenCalledTimes(1);
    });

    (useLearnerStore as unknown as jest.Mock).mockImplementation((selector) => {
      const mockState = {
        questions: [
          {
            id: questionId,
            learnerTextResponse: "Updated",
            learnerUrlResponse: "",
            learnerChoices: [],
            learnerAnswerChoice: null,
            learnerFileResponse: [],
            presentationResponse: null,
            selectedLanguage: "en",
          },
        ],
        userPreferedLanguage: "en",
      };
      return selector(mockState);
    });
    rerender();
    jest.advanceTimersByTime(100);

    expect(mockSubmitQuestion).toHaveBeenCalledTimes(1);

    resolveFirstSave();
  });

  it("does not show a false success toast when the save fails", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({
      ok: false,
      status: 400,
      message:
        "Your submission is too large for automatic grading. Try reducing its length and submit it again.",
    });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 1000,
        showToast: true,
      }),
    );

    mockStoreWithQuestion(questionId, { learnerTextResponse: "Test answer" });
    rerender();
    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenCalled();
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Your submission is too large for automatic grading. Try reducing its length and submit it again.",
      { duration: 8000 },
    );
  });

  it("does not retry a terminal 4xx failure (resubmitting the same oversized payload cannot succeed)", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({ ok: false, status: 400 });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 1000,
      }),
    );

    mockStoreWithQuestion(questionId, { learnerTextResponse: "Test answer" });
    rerender();
    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenCalledTimes(1);
    });

    // Advance past every backoff window in the retry schedule — a terminal
    // failure must not produce a second call.
    jest.advanceTimersByTime(30_000);
    expect(mockSubmitQuestion).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure on the documented backoff schedule, then gives up honestly", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({ ok: false, status: 503 });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 1000,
      }),
    );

    mockStoreWithQuestion(questionId, { learnerTextResponse: "Test answer" });
    rerender();
    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenCalledTimes(1);
    });

    jest.advanceTimersByTime(2000);
    await waitFor(() => expect(mockSubmitQuestion).toHaveBeenCalledTimes(2));

    jest.advanceTimersByTime(5000);
    await waitFor(() => expect(mockSubmitQuestion).toHaveBeenCalledTimes(3));

    jest.advanceTimersByTime(10_000);
    await waitFor(() => expect(mockSubmitQuestion).toHaveBeenCalledTimes(4));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't save your last response after several tries. Copy it somewhere safe, then reload the page and try again.",
        { duration: 8000 },
      );
    });

    // All 3 retries (4 attempts total) are exhausted — no fifth attempt.
    jest.advanceTimersByTime(30_000);
    expect(mockSubmitQuestion).toHaveBeenCalledTimes(4);
  });

  it("recovers silently if a retry succeeds (no error toast, no further retries)", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, data: {} as any });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 1000,
      }),
    );

    mockStoreWithQuestion(questionId, { learnerTextResponse: "Test answer" });
    rerender();
    jest.advanceTimersByTime(1000);

    await waitFor(() => expect(mockSubmitQuestion).toHaveBeenCalledTimes(1));

    jest.advanceTimersByTime(2000);
    await waitFor(() => expect(mockSubmitQuestion).toHaveBeenCalledTimes(2));

    expect(toast.error).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30_000);
    expect(mockSubmitQuestion).toHaveBeenCalledTimes(2);
  });

  it("never marks a failed save as saved: a reverted edit after a terminal failure still gets saved", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    // Every attempt in this test fails terminally, so nothing here is ever
    // retried automatically — each call below is driven by a genuine edit.
    mockSubmitQuestion.mockResolvedValue({ ok: false, status: 400 });

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
        enabled: true,
        debounceMs: 1000,
      }),
    );

    mockStoreWithQuestion(questionId, { learnerTextResponse: "abc" });
    rerender();
    jest.advanceTimersByTime(1000);
    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenLastCalledWith(
        assignmentId,
        attemptId,
        questionId,
        expect.objectContaining({ learnerTextResponse: "abc" }),
      );
    });
    expect(mockSubmitQuestion).toHaveBeenCalledTimes(1);

    mockStoreWithQuestion(questionId, { learnerTextResponse: "abcd" });
    rerender();
    jest.advanceTimersByTime(1000);
    await waitFor(() => expect(mockSubmitQuestion).toHaveBeenCalledTimes(2));

    // Revert to the exact text that already failed once. If the earlier
    // failure had (bug) marked "abc" as saved, this would be silently
    // skipped as "unchanged since last save" and submitQuestion would not
    // be called a third time.
    mockStoreWithQuestion(questionId, { learnerTextResponse: "abc" });
    rerender();
    jest.advanceTimersByTime(1000);
    await waitFor(() => {
      expect(mockSubmitQuestion).toHaveBeenCalledTimes(3);
      expect(mockSubmitQuestion).toHaveBeenLastCalledWith(
        assignmentId,
        attemptId,
        questionId,
        expect.objectContaining({ learnerTextResponse: "abc" }),
      );
    });
  });
});
