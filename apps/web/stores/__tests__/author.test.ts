import { QuestionAuthorStore } from "@/config/types";
import { useAuthorStore } from "../author";

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
