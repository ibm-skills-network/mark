/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useAutoSaveResponse } from "../use-auto-save-response";
import { useLearnerStore, useLearnerOverviewStore } from "@/stores/learner";
import { submitQuestion } from "@/lib/talkToBackend";

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

    mockSubmitQuestion.mockResolvedValue({} as any);

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

    mockSubmitQuestion.mockResolvedValue({} as any);

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

    mockSubmitQuestion.mockResolvedValue({} as any);

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

    mockSubmitQuestion.mockResolvedValue({} as any);

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
    mockSubmitQuestion.mockResolvedValue({} as any);

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

  it("should handle save errors gracefully", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockRejectedValue(new Error("Network error"));

    const consoleError = jest.spyOn(console, "error").mockImplementation();

    const { rerender } = renderHook(() =>
      useAutoSaveResponse(assignmentId, attemptId, questionId, {
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
      expect(mockSubmitQuestion).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "Auto-save failed:",
        expect.any(Error),
      );
    });

    consoleError.mockRestore();
  });

  it("should support immediate save via saveNow", async () => {
    const assignmentId = 123;
    const attemptId = 456;
    const questionId = 789;

    mockSubmitQuestion.mockResolvedValue({} as any);

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

    mockSubmitQuestion.mockResolvedValue({} as any);

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

    mockSubmitQuestion.mockResolvedValue({} as any);

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
    const firstSavePromise = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });

    mockSubmitQuestion
      .mockReturnValueOnce(firstSavePromise as any)
      .mockResolvedValue({} as any);

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

    const { result, rerender } = renderHook(() =>
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
});
