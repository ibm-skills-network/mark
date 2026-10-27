import { renderHook } from "@testing-library/react";
import { useAuthorStore } from "@/stores/author";
import { useAuthorContext } from "../useAuthorContext";

const question = (id: number, text: string) => ({
  id,
  type: "SINGLE_CORRECT",
  question: text,
  totalPoints: 1,
  choices: [],
});

describe("useAuthorContext", () => {
  it("describes the draft as it is when called, not as it was rendered", async () => {
    useAuthorStore.setState({
      name: "Anatomy",
      activeAssignmentId: 7,
      questions: [question(1, "Which bone protects the brain?")] as never,
      questionOrder: [1],
    });
    const { result } = renderHook(() => useAuthorContext());

    // The chat's operations change the draft and it asks for context again
    // before React re-renders.
    useAuthorStore.setState({
      questions: [
        question(1, "Which bone protects the brain?"),
        question(2, "Which organ produces insulin?"),
      ] as never,
      questionOrder: [1, 2],
    });
    const context = await result.current.getContextMessage();

    expect(context.content).toContain("Number of Questions: 2");
    expect(context.content).toContain("[ID: 2] Which organ produces insulin?");
  });
});
