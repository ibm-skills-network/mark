import type { QuestionStore } from "@/config/types";
import { useLearnerStore } from "../learner";

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn(),
}));

const frozen = [
  { id: 2, choice: "B" },
  { id: 1, choice: "A" },
];

const questionWithoutChoices = (
  randomizedChoices: QuestionStore["randomizedChoices"],
): QuestionStore =>
  ({
    id: 11,
    type: "SINGLE_CORRECT",
    totalPoints: 1,
    question: "Pick one",
    choices: [],
    randomizedChoices,
  }) as unknown as QuestionStore;

describe("setQuestions randomizedChoices fallback", () => {
  beforeEach(() => {
    useLearnerStore.setState({ questions: [] });
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fills empty choices from the randomizedChoices array", () => {
    useLearnerStore.getState().setQuestions([questionWithoutChoices(frozen)]);

    expect(useLearnerStore.getState().questions[0]?.choices).toEqual(frozen);
  });

  it("fills empty choices from a legacy randomizedChoices string", () => {
    useLearnerStore
      .getState()
      .setQuestions([questionWithoutChoices(JSON.stringify(frozen))]);

    expect(useLearnerStore.getState().questions[0]?.choices).toEqual(frozen);
  });

  it("leaves choices empty when randomizedChoices is null or unparsable", () => {
    useLearnerStore
      .getState()
      .setQuestions([
        questionWithoutChoices(null),
        { ...questionWithoutChoices("{oops"), id: 12 },
      ]);

    const [first, second] = useLearnerStore.getState().questions;
    expect(first?.choices).toEqual([]);
    expect(second?.choices).toEqual([]);
  });
});
