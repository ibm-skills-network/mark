/**
 * Checks the Mark chat eval harness itself, with the model scripted: that the
 * simulated browser reproduces what the real client sends and shows, and that
 * scenarios score the recorded behaviour correctly. No network or credentials.
 *
 * Runs with the unit tests: yarn test test/mark-chat-eval/harness.spec.ts
 */
import { MarkChatService } from "../../src/api/user/services/mark-chat.service";
import { createMarkChatService, runScenarioOnce, runTurn } from "./harness";
import { SCENARIOS } from "./scenarios";
import {
  ClientOperation,
  SimulatedAuthorClient,
} from "./simulated-author-client";

interface ScriptedReply {
  text: string;
  operations?: ClientOperation[];
}

interface StreamCall {
  system: string;
  messages: Array<{ role: string; content: string }>;
}

const streamTextMock = jest.fn();
let script: ScriptedReply[] = [];

jest.mock("@ai-sdk/openai", () => ({
  openai: jest.fn(() => "scripted-model"),
}));

jest.mock("ai", () => {
  const actual = jest.requireActual("ai") as Record<string, unknown>;
  return {
    ...actual,
    streamText: (...parameters: unknown[]) =>
      streamTextMock(...parameters) as unknown,
  };
});

/** What streamText yields when the model calls client-executed tools. */
function scriptedStream(reply: ScriptedReply) {
  const chunks = [reply.text];
  return {
    textStream: {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            chunks.length > 0
              ? { done: false, value: chunks.shift() }
              : { done: true, value: undefined },
          ),
      }),
    },
    steps: Promise.resolve([
      {
        toolResults: (reply.operations ?? []).map((operation) => ({
          toolName: operation.function,
          output: JSON.stringify({
            clientExecution: true,
            function: operation.function,
            params: operation.params,
          }),
        })),
      },
    ]),
  };
}

const generateAnatomy = (questionType: string): ClientOperation => ({
  function: "generateQuestionsFromObjectives",
  params: {
    learningObjectives: "Introductory anatomy",
    questionTypes: [questionType],
    count: 5,
  },
});

const scenario = (id: string) => {
  const found = SCENARIOS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No scenario ${id}`);
  return found;
};

function oneAuthorQuestion(): SimulatedAuthorClient {
  return new SimulatedAuthorClient({
    assignmentId: 7,
    name: "Anatomy",
    questions: [
      {
        id: 1001,
        type: "TRUE_FALSE",
        question: "The femur is the longest bone in the body.",
        totalPoints: 10,
        origin: "author",
      },
    ],
  });
}

describe("Mark chat eval harness", () => {
  let service: MarkChatService;

  beforeAll(async () => {
    service = await createMarkChatService();
  });

  beforeEach(() => {
    script = [];
    streamTextMock.mockReset();
    streamTextMock.mockImplementation(() => {
      const next = script.shift();
      if (!next) throw new Error("Scripted model ran out of replies");
      return scriptedStream(next);
    });
  });

  it("runs the operations and shows the result message from the recording", async () => {
    const client = oneAuthorQuestion();
    script = [
      { text: "Absolutely!", operations: [generateAnatomy("SINGLE_CORRECT")] },
    ];

    const turn = await runTurn(service, client, "quiz on anatomy");

    // The client strips the marker but keeps the separator the server writes before it.
    expect(turn.reply).toBe("Absolutely!\n\n");
    expect(turn.results.every((result) => result.success)).toBe(true);
    expect(client.markQuestions).toHaveLength(5);
    expect(client.messages.at(-1)?.content).toBe(
      "✅ I've completed 1 operation.\n\n1. GenerateQuestionsFromObjectives: Successfully completed - Successfully generated 5 questions based on your learning objectives.\n",
    );
  });

  it("sends the next turn the history and fresh context the browser would", async () => {
    const client = oneAuthorQuestion();
    script = [
      { text: "Absolutely!", operations: [generateAnatomy("SINGLE_CORRECT")] },
      { text: "Sure." },
    ];

    await runTurn(service, client, "quiz on anatomy");
    await runTurn(service, client, "make it multi select");

    const second = streamTextMock.mock.calls[1][0] as StreamCall;
    expect(second.system).toContain("MARK ASSISTANT CONTEXT (AUTHOR MODE)");
    expect(second.system).toContain("Number of Questions: 6");
    expect(second.messages.map((message) => message.role)).toEqual([
      "assistant",
      "user",
      "assistant",
      "assistant",
      "user",
    ]);
    expect(second.messages[3].content).toContain("✅ I've completed");
    expect(second.messages.at(-1)?.content).toBe("make it multi select");
  });

  it("fails the complaint scenario when Mark generates again, passes when it does not", async () => {
    script = [
      { text: "Sorry!", operations: [generateAnatomy("MULTIPLE_CORRECT")] },
    ];
    const regenerated = await runScenarioOnce(service, scenario("S4"));
    expect(regenerated.pass).toBe(false);
    expect(
      regenerated.checks
        .filter((check) => !check.pass)
        .map((check) => check.name),
    ).toEqual(["no generation", "question count unchanged"]);

    script = [{ text: "Want me to remove 5 of them?" }];
    const asked = await runScenarioOnce(service, scenario("S4"));
    expect(asked.pass).toBe(true);
  });

  it("publish gives temporary IDs the next database IDs and leaves author questions alone", async () => {
    const client = oneAuthorQuestion();
    script = [
      { text: "Absolutely!", operations: [generateAnatomy("SINGLE_CORRECT")] },
    ];
    await runTurn(service, client, "quiz on anatomy");
    const temporaryId = client.markQuestions[0].id;

    client.publish();

    expect(client.authorQuestions.map((question) => question.id)).toEqual([
      1001,
    ]);
    // Database IDs continue straight after the author's, as in production.
    expect(client.markQuestions.map((question) => question.id)).toEqual([
      1002, 1003, 1004, 1005, 1006,
    ]);
    const [stale] = client.executeOperations([
      { function: "deleteQuestion", params: { questionId: temporaryId } },
    ]);
    expect(stale).toMatchObject({
      success: false,
      message: `Failed to delete question: Question with ID ${temporaryId} not found`,
    });
  });

  it("writes an unvalidated question type through, like the bridge", () => {
    const client = oneAuthorQuestion();
    const [result] = client.executeOperations([
      {
        function: "modifyQuestion",
        params: { questionId: 1001, questionType: "MULTIPLE_SELECT" },
      },
    ]);
    expect(result.success).toBe(true);
    expect(client.questions[0].type).toBe("MULTIPLE_SELECT");
  });
});
