/**
 * @jest-environment jsdom
 */

/**
 * These tests drive the real store, not the draft module's exports. The unit
 * suite proved the draft functions correct while nothing in the page flow
 * actually called the cleanup — wiring is exactly what unit tests of the
 * exported functions cannot see, so it is pinned here.
 */
import type { QuestionStore } from "@/config/types";
import { loadDraft, saveDraft } from "@/lib/learner-draft";
import { useLearnerStore } from "@/stores/learner";

jest.useFakeTimers();

function makeQuestion(id: number): QuestionStore {
  return { id, type: "TEXT" } as unknown as QuestionStore;
}

describe("draft wiring through the learner store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLearnerStore.setState({ activeAttemptId: null, questions: [] });
  });

  it("prunes other attempts' drafts when the active attempt changes", () => {
    saveDraft(1, [{ id: 10, learnerTextResponse: "old attempt" }]);
    saveDraft(2, [{ id: 10, learnerTextResponse: "current attempt" }]);

    useLearnerStore.getState().setLearnerStore({ activeAttemptId: 2 });

    expect(loadDraft(1)).toBeNull();
    expect(loadDraft(2)?.["10"].learnerTextResponse).toBe("current attempt");
  });

  it("routes the named attempt setter through the same cleanup", () => {
    saveDraft(1, [{ id: 10, learnerTextResponse: "old attempt" }]);

    useLearnerStore.getState().setActiveAttemptId(2);

    expect(loadDraft(1)).toBeNull();
    expect(useLearnerStore.getState().activeAttemptId).toBe(2);
  });

  it("cancels a write scheduled for the previous attempt on switch", () => {
    const store = useLearnerStore.getState();
    store.setLearnerStore({ activeAttemptId: 1 });
    useLearnerStore.setState({ questions: [makeQuestion(10)] });

    // Type, then navigate to another attempt before the debounce fires. The
    // pending write captured attempt 1; landing after the switch would
    // recreate the draft that cleanup just removed.
    store.setTextResponse("typed just before navigating", 10);
    store.setLearnerStore({ activeAttemptId: 2 });
    jest.runOnlyPendingTimers();

    expect(loadDraft(1)).toBeNull();
  });

  it("persists a true/false answer through the debounced save", () => {
    const store = useLearnerStore.getState();
    store.setLearnerStore({ activeAttemptId: 3 });
    useLearnerStore.setState({ questions: [makeQuestion(10)] });

    store.setAnswerChoice(false, 10);
    jest.runOnlyPendingTimers();

    expect(loadDraft(3)?.["10"].learnerAnswerChoice).toBe(false);
  });

  it("drops every draft when the attempt ends without a successor", () => {
    saveDraft(1, [{ id: 10, learnerTextResponse: "submitted work" }]);
    const store = useLearnerStore.getState();
    store.setLearnerStore({ activeAttemptId: 1 });

    // The timer-expiry submit path clears the active attempt this way.
    store.setLearnerStore({ activeAttemptId: null });

    expect(loadDraft(1)).toBeNull();
  });
});
