import type { QuestionStore } from "@/config/types";
import { useLearnerStore } from "../learner";

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn(),
}));

const fatQuestion = (): Partial<QuestionStore> => ({
  id: 7,
  type: "SINGLE_CORRECT",
  totalPoints: 1,
  question: '<p>Pick one</p><img src="data:image/png;base64,AAAA">',
  choices: [
    { choice: "A", isCorrect: true, points: 1 },
    { choice: "B", isCorrect: false, points: 0 },
  ],
  translations: {
    es: { translatedText: "elige", translatedChoices: [] },
    fr: { translatedText: "choisis", translatedChoices: [] },
  },
  status: "edited",
  learnerTextResponse: "draft text",
  learnerChoices: ["1"],
  selectedLanguage: "es",
});

const readPersistedLearnerState = (): {
  questions: Record<string, unknown>[];
} => {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && /^learner-(?!overview)/.test(key)) {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as {
        state: { questions: Record<string, unknown>[] };
      };
      return parsed.state;
    }
  }
  throw new Error("no persisted learner state found");
};

describe("useLearnerStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Server content persisted per question once multiplied localStorage usage
  // past the quota (question HTML can embed images), which trapped learners
  // in a clear-and-reload loop. Only learner-authored draft state may be
  // written; content is re-fetched and merged over it on every load.
  it("persists learner drafts but not server question content", () => {
    useLearnerStore
      .getState()
      .setQuestions([fatQuestion() as unknown as QuestionStore]);

    const persisted = readPersistedLearnerState();
    const [question] = persisted.questions;

    expect(question.id).toBe(7);
    expect(question.status).toBe("edited");
    expect(question.learnerTextResponse).toBe("draft text");
    expect(question.learnerChoices).toEqual(["1"]);
    expect(question.selectedLanguage).toBe("es");

    expect(question.question).toBeUndefined();
    expect(question.translations).toBeUndefined();
    expect(question.choices).toBeUndefined();
  });
});

describe("useLearnerStore attempt-scoped drafts", () => {
  const served = (): QuestionStore =>
    ({
      id: 7,
      type: "SINGLE_CORRECT",
      totalPoints: 1,
      question: "<p>Pick one</p>",
      choices: [
        { choice: "A", isCorrect: true, points: 1 },
        { choice: "B", isCorrect: false, points: 0 },
      ],
    }) as unknown as QuestionStore;

  beforeEach(() => {
    localStorage.clear();
    useLearnerStore.setState({ questions: [], activeAttemptId: null });
  });

  // Selections are stored as positions in the choice list, and every attempt
  // shuffles that list (and may draw a different variant). A draft carried
  // into another attempt selects options the learner never picked.
  it("drops the previous attempt's selections when a different attempt loads", () => {
    const store = useLearnerStore.getState();
    store.beginAttempt(100);
    store.setQuestions([served()]);
    store.setChoices(["1"], 7);

    useLearnerStore.getState().beginAttempt(101);
    useLearnerStore.getState().setQuestions([served()]);

    const [question] = useLearnerStore.getState().questions;
    expect(question.learnerChoices ?? []).toEqual([]);
    expect(useLearnerStore.getState().activeAttemptId).toBe(101);
  });

  it("drops drafts left behind when no attempt was recorded for them", () => {
    useLearnerStore.getState().setQuestions([served()]);
    useLearnerStore.getState().setChoices(["1"], 7);

    useLearnerStore.getState().beginAttempt(101);
    useLearnerStore.getState().setQuestions([served()]);

    expect(useLearnerStore.getState().questions[0].learnerChoices ?? []).toEqual(
      [],
    );
  });

  it("keeps the draft when the same attempt is loaded again", () => {
    const store = useLearnerStore.getState();
    store.beginAttempt(100);
    store.setQuestions([served()]);
    store.setChoices(["1"], 7);

    useLearnerStore.getState().beginAttempt(100);
    useLearnerStore.getState().setQuestions([served()]);

    expect(useLearnerStore.getState().questions[0].learnerChoices).toEqual([
      "1",
    ]);
  });
});
