import { collectReportDiagnostics } from "../report-diagnostics";
import { clearRequestLog } from "../request-log";
import { useLearnerStore } from "@/stores/learner";
import type { QuestionStore } from "@/config/types";

jest.mock("@/lib/talkToBackend", () => ({ getUser: jest.fn() }));

const question = (): QuestionStore =>
  ({
    id: 29377,
    type: "SINGLE_CORRECT",
    totalPoints: 1,
    question: "<p>Which pair?</p>",
    choices: [
      { choice: "Apache Kafka and Apache Flink", isCorrect: true, points: 1 },
      { choice: "Apache Hadoop and Apache Spark", isCorrect: false, points: 0 },
    ],
    translations: {
      es: {
        translatedText: "¿Qué par?",
        translatedChoices: [
          { choice: "Apache Kafka y Apache Flink" },
          { choice: "Apache Hadoop y Apache Spark" },
        ],
      },
    },
    learnerChoices: ["1"],
    learnerTextResponse: "",
    status: "edited",
  }) as unknown as QuestionStore;

describe("collectReportDiagnostics", () => {
  beforeEach(() => {
    localStorage.clear();
    clearRequestLog();
    window.history.replaceState({}, "", "/learner/3723/questions?lang=es");
    useLearnerStore.setState({
      questions: [question()],
      activeAttemptId: 1630573,
      userPreferedLanguage: "es",
    });
  });

  it("captures what the learner was shown and which option was selected", () => {
    const diagnostics = collectReportDiagnostics({
      role: "learner",
      assignmentId: 3723,
    });

    expect(diagnostics?.session).toMatchObject({
      attemptId: 1630573,
      assignmentId: 3723,
      role: "learner",
      attemptLanguage: "es",
    });
    expect(diagnostics?.rendered).toEqual([
      {
        questionId: 29377,
        type: "SINGLE_CORRECT",
        choices: [
          { text: "Apache Kafka y Apache Flink", selected: false },
          { text: "Apache Hadoop y Apache Spark", selected: true },
        ],
      },
    ]);
    expect(diagnostics?.draft).toEqual({
      activeAttemptId: 1630573,
      questions: [
        { id: 29377, status: "edited", selected: ["1"], textLength: 0 },
      ],
    });
  });

  it("falls back to the authored choices when the language has none", () => {
    useLearnerStore.setState({ userPreferedLanguage: "de" });

    const diagnostics = collectReportDiagnostics({ role: "learner" });

    expect(diagnostics?.rendered?.[0].choices[0].text).toBe(
      "Apache Kafka and Apache Flink",
    );
  });

  it("never includes what the learner typed or which answers are correct", () => {
    useLearnerStore.setState({
      questions: [
        {
          ...question(),
          learnerTextResponse: "my private essay answer",
        } as QuestionStore,
      ],
    });

    const serialized = JSON.stringify(
      collectReportDiagnostics({ role: "learner" }),
    );

    expect(serialized).not.toContain("my private essay answer");
    expect(serialized).not.toContain("isCorrect");
    expect(serialized).toContain('"textLength":23');
  });

  it("records the page without its query string secrets", () => {
    window.history.replaceState(
      {},
      "",
      "/learner/3723/questions?lang=es&code=oauth-secret",
    );

    const diagnostics = collectReportDiagnostics({ role: "learner" });

    expect(diagnostics?.page?.url).toContain("/learner/3723/questions");
    expect(diagnostics?.page?.url).not.toContain("oauth-secret");
  });

  it("returns undefined instead of throwing when the browser state is unreadable", () => {
    const spy = jest
      .spyOn(useLearnerStore, "getState")
      .mockImplementation(() => {
        throw new Error("store unavailable");
      });

    expect(collectReportDiagnostics({ role: "learner" })).toBeUndefined();

    spy.mockRestore();
  });
});
