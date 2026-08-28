import { QuestionAuthorStore } from "@/config/types";
import {
  getAssignmentVersion,
  listAssignmentVersions,
  restoreAssignmentVersion,
} from "@/lib/author";
import { useAssignmentConfig } from "../assignmentConfig";
import { useAuthorStore } from "../author";

jest.mock("@/lib/author", () => ({
  getAssignmentVersion: jest.fn(),
  listAssignmentVersions: jest.fn(),
  restoreAssignmentVersion: jest.fn(),
}));

const makeQuestion = (id: number, index: number): QuestionAuthorStore => ({
  id,
  index,
  question: `Question ${id}`,
  type: "TEXT",
  totalPoints: 1,
  scoring: {
    type: "CRITERIA_BASED",
    rubrics: [],
  },
  numRetries: 1,
  choices: [],
  variants: [],
  alreadyInBackend: true,
  answer: null,
  assignmentId: 1,
  gradingContextQuestionIds: [],
  randomizedChoices: false,
});

describe("useAuthorStore question order syncing", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthorStore.getState().deleteStore();
  });

  it("syncs questionOrder when questions are set directly", () => {
    useAuthorStore
      .getState()
      .setQuestions([makeQuestion(2, 1), makeQuestion(1, 2)]);

    expect(useAuthorStore.getState().questionOrder).toEqual([2, 1]);
  });

  it("appends new questions to questionOrder when authors add them", () => {
    useAuthorStore
      .getState()
      .setQuestions([makeQuestion(1, 1), makeQuestion(2, 2)]);

    useAuthorStore.getState().addQuestion(makeQuestion(3, 3));

    expect(useAuthorStore.getState().questionOrder).toEqual([1, 2, 3]);
  });

  it("removes deleted question ids from questionOrder", () => {
    useAuthorStore
      .getState()
      .setQuestions([
        makeQuestion(1, 1),
        makeQuestion(2, 2),
        makeQuestion(3, 3),
      ]);

    useAuthorStore.getState().removeQuestion(2);

    expect(useAuthorStore.getState().questionOrder).toEqual([1, 3]);
    expect(
      useAuthorStore.getState().questions.map((question) => question.id),
    ).toEqual([1, 3]);
  });

  it("keeps questionOrder stable when replacing a question", () => {
    useAuthorStore
      .getState()
      .setQuestions([makeQuestion(1, 1), makeQuestion(2, 2)]);

    useAuthorStore.getState().replaceQuestion(2, {
      ...makeQuestion(2, 2),
      question: "Updated question",
    });

    expect(useAuthorStore.getState().questionOrder).toEqual([1, 2]);
  });
});

describe("hydrateAuthorStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthorStore.getState().deleteStore();
  });

  it("does not set hasUnsavedChanges", () => {
    useAuthorStore.getState().hydrateAuthorStore({
      name: "Assignment X",
      activeAssignmentId: 42,
      questions: [makeQuestion(1, 1)],
    });
    expect(useAuthorStore.getState().hasUnsavedChanges).toBe(false);
  });

  it("clears hasUnsavedChanges even when the store was dirty before", () => {
    useAuthorStore.getState().setDataFromBackend({ name: "Dirty" });
    expect(useAuthorStore.getState().hasUnsavedChanges).toBe(true);

    useAuthorStore.getState().hydrateAuthorStore({
      name: "Clean",
      activeAssignmentId: 1,
      questions: [makeQuestion(1, 1)],
    });
    expect(useAuthorStore.getState().hasUnsavedChanges).toBe(false);
  });

  it("updates name and activeAssignmentId", () => {
    useAuthorStore.getState().hydrateAuthorStore({
      name: "My Assignment",
      activeAssignmentId: 99,
      questions: [],
    });
    const state = useAuthorStore.getState();
    expect(state.name).toBe("My Assignment");
    expect(state.activeAssignmentId).toBe(99);
  });

  it("applies the provided question order", () => {
    const questions = [
      makeQuestion(1, 1),
      makeQuestion(2, 2),
      makeQuestion(3, 3),
    ];
    useAuthorStore.getState().hydrateAuthorStore({
      questions,
      questionOrder: [3, 1, 2],
    });
    expect(useAuthorStore.getState().questionOrder).toEqual([3, 1, 2]);
  });

  it("derives question order from ids when none is provided", () => {
    useAuthorStore.getState().hydrateAuthorStore({
      questions: [makeQuestion(10, 1), makeQuestion(20, 2)],
    });
    expect(useAuthorStore.getState().questionOrder).toEqual([10, 20]);
  });

  it("falls back to existing questions when none are passed", () => {
    useAuthorStore.getState().hydrateAuthorStore({
      questions: [makeQuestion(10, 1)],
      questionOrder: [10],
    });

    useAuthorStore.getState().hydrateAuthorStore({ name: "Updated" });

    const state = useAuthorStore.getState();
    expect(state.questions).toHaveLength(1);
    expect(state.questions[0].id).toBe(10);
    expect(state.hasUnsavedChanges).toBe(false);
  });
});

describe("restoreVersion", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    useAuthorStore.getState().deleteStore();
    useAssignmentConfig.getState().deleteStore();
  });

  it("preserves zero-valued retake settings when hydrating restored assignments", async () => {
    useAuthorStore.getState().hydrateAuthorStore({
      activeAssignmentId: 123,
      name: "Current assignment",
    });
    useAuthorStore
      .getState()
      .setVersions([{ id: 7, versionNumber: "1.0.0", isActive: true } as any]);
    useAssignmentConfig.getState().setAssignmentConfigStore({
      attemptsBeforeCoolDown: 3,
      retakeAttemptCoolDownMinutes: 10,
    });

    (restoreAssignmentVersion as jest.Mock).mockResolvedValue({
      id: 7,
      versionNumber: "1.0.0",
      isActive: true,
    });
    (getAssignmentVersion as jest.Mock).mockResolvedValue({
      assignment: {
        id: 123,
        name: "Restored assignment",
        introduction: "Intro",
        instructions: "Instructions",
        gradingCriteriaOverview: "Criteria",
        questions: [],
        numAttempts: 0,
        attemptsBeforeCoolDown: 0,
        retakeAttemptCoolDownMinutes: 0,
      },
    });
    (listAssignmentVersions as jest.Mock).mockResolvedValue([
      { id: 7, versionNumber: "1.0.0", isActive: true },
    ]);

    await useAuthorStore.getState().restoreVersion(7);

    const configState = useAssignmentConfig.getState();
    expect(configState.attemptsBeforeCoolDown).toBe(0);
    expect(configState.retakeAttemptCoolDownMinutes).toBe(0);
  });
});
