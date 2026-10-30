import { useLearnerStore } from "@/stores/learner";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLearnerContext } from "../useLearnerContext";

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn(),
}));

const QUESTION_TEXT = "<p>Submit the completed process map.</p>";

const fullQuestion = {
  id: 9402,
  type: "UPLOAD" as const,
  totalPoints: 7,
  question: QUESTION_TEXT,
  status: "unedited" as const,
};

/** What a page reload does: the store comes back from localStorage alone. */
const reloadStoreFromStorage = async () => {
  const key = useLearnerStore.persist.getOptions().name;
  const saved = localStorage.getItem(key);
  useLearnerStore.setState({ questions: [] });
  localStorage.setItem(key, saved);
  await useLearnerStore.persist.rehydrate();
};

describe("useLearnerContext", () => {
  beforeEach(() => {
    localStorage.clear();
    useLearnerStore.setState({ questions: [], activeQuestionNumber: 1 });
  });

  it("does not describe a question it only has saved answers for", async () => {
    useLearnerStore.getState().setQuestions([fullQuestion]);
    useLearnerStore.getState().clearLearnerAnswers();
    await reloadStoreFromStorage();

    const { result } = renderHook(() => useLearnerContext());
    const { content } = await result.current.getContextMessage();

    expect(content).not.toContain("undefined");
    expect(content).not.toContain("CURRENT QUESTION");
    expect(content).not.toContain("Answer: False");
    expect(content).toContain("NO QUESTION LOADED");
    expect(result.current.currentQuestion).toBeNull();
  });

  it("describes the question once its content has loaded", async () => {
    const { result } = renderHook(() => useLearnerContext());

    act(() => {
      useLearnerStore.getState().setQuestions([fullQuestion]);
    });

    await waitFor(() => {
      expect(result.current.currentQuestion?.id).toBe(9402);
    });
    const { content } = await result.current.getContextMessage();

    expect(content).toContain("CURRENT QUESTION");
    expect(content).toContain(`Question Text: ${QUESTION_TEXT}`);
    expect(content).toContain("Points: 7");
    expect(content).not.toContain("NO QUESTION LOADED");
  });
});
