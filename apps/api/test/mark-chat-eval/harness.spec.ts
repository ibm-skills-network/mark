/**
 * Checks the Mark chat eval harness itself, with the model scripted: that the
 * simulated browser runs the agent loop the way the real client does, and
 * that scenarios score the recorded behaviour correctly. No network or
 * credentials.
 *
 * Runs with the unit tests: yarn test test/mark-chat-eval/harness.spec.ts
 */
import { MarkChatService } from "../../src/api/user/services/mark-chat.service";
import {
  createMarkChatService,
  InMemoryChatRepository,
  runScenarioOnce,
  runTurn,
} from "./harness";
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
  messages: Array<{ role: string; content: unknown }>;
}

const streamTextMock = jest.fn();
let script: ScriptedReply[] = [];
let nextCallId = 1;

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

/**
 * What streamText yields when the model calls author operations, which have
 * no execute in the agent loop: the step ends on the calls.
 */
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
        toolCalls: (reply.operations ?? []).map((operation) => ({
          toolCallId: `call-${nextCallId++}`,
          toolName: operation.function,
          input: operation.params,
        })),
        content: [],
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

  it("runs the operations the model calls and shows the recording's summary", async () => {
    const client = oneAuthorQuestion();
    script = [
      { text: "Absolutely!", operations: [generateAnatomy("SINGLE_CORRECT")] },
      { text: "Added 5 questions." },
    ];

    const turn = await runTurn(service, client, "quiz on anatomy");

    expect(turn.reply).toBe("Absolutely!\n\nAdded 5 questions.");
    expect(turn.results.every((result) => result.success)).toBe(true);
    expect(client.markQuestions).toHaveLength(5);
    expect(
      client.messages.find((message) => message.displayOnly)?.content,
    ).toBe(
      "✅ I've completed 1 operation.\n\n1. GenerateQuestionsFromObjectives: Successfully completed - Successfully generated 5 questions based on your learning objectives.\n",
    );
  });

  it("continues with the outcomes and a fresh context before the model answers", async () => {
    const client = oneAuthorQuestion();
    script = [
      { text: "Absolutely!", operations: [generateAnatomy("SINGLE_CORRECT")] },
      { text: "Added 5 questions." },
    ];

    await runTurn(service, client, "quiz on anatomy");

    const continuation = streamTextMock.mock.calls[1][0] as StreamCall;
    expect(continuation.system).toContain("Number of Questions: 6");
    expect(continuation.messages.map((message) => message.role)).toEqual([
      "assistant",
      "user",
      "assistant",
      "tool",
    ]);
    const [result] = continuation.messages[3].content as Array<{
      output: { value: { questions: Array<{ id: number }> } };
    }>;
    expect(
      result.output.value.questions.map((question) => question.id),
    ).toEqual(client.markQuestions.map((question) => question.id));
  });

  it("saves the outcomes onto the stored assistant message", async () => {
    const repository = new InMemoryChatRepository();
    const storingService = await createMarkChatService(repository);
    script = [
      { text: "Absolutely!", operations: [generateAnatomy("SINGLE_CORRECT")] },
      { text: "Added 5 questions." },
    ];

    await runTurn(storingService, oneAuthorQuestion(), "quiz on anatomy");

    const [call] = repository.messages[0].toolCalls as Array<{
      output?: { success: boolean };
    }>;
    expect(call.output?.success).toBe(true);
    expect(repository.messages).toHaveLength(2);
  });

  it("fails the complaint scenario when Mark generates again, passes when it does not", async () => {
    script = [
      { text: "Sorry!", operations: [generateAnatomy("MULTIPLE_CORRECT")] },
      { text: "Added 5 more." },
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
      { text: "Done." },
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
    expect(
      client.applyOperation({
        function: "deleteQuestion",
        params: { questionId: temporaryId },
      }),
    ).toMatchObject({
      success: false,
      message: `Failed to delete question: Question with ID ${temporaryId} not found`,
    });
  });

  it("writes an unvalidated question type through, like the bridge", () => {
    const client = oneAuthorQuestion();
    const result = client.applyOperation({
      function: "modifyQuestion",
      params: { questionId: 1001, questionType: "MULTIPLE_SELECT" },
    });
    expect(result.success).toBe(true);
    expect(client.questions[0].type).toBe("MULTIPLE_SELECT");
  });
});
