/**
 * @jest-environment node
 */
import {
  isAgentLoopResponse,
  readAgentTurn,
  runPendingCalls,
} from "../agentLoop";
import { runAuthorOperation } from "../authorStoreUtil";

jest.mock("../authorStoreUtil", () => ({ runAuthorOperation: jest.fn() }));

const runAuthorOperationMock = runAuthorOperation as jest.Mock;

/** A response body that arrives in the given pieces. */
function bodyOf(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      pieces.forEach((piece) => controller.enqueue(encoder.encode(piece)));
      controller.close();
    },
  });
}

describe("agent loop (browser)", () => {
  beforeEach(() => {
    runAuthorOperationMock.mockReset();
    (globalThis as any).window = {
      authorStoreBridge: {
        getState: () => ({
          questions: [
            {
              id: 11,
              type: "SINGLE_CORRECT",
              question: "Which bone protects the brain?",
            },
            { id: 12, type: "TEXT", question: "Explain the role of enzymes." },
          ],
        }),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it("reads events even when a line is split across chunks", async () => {
    const texts: string[] = [];
    const turn = await readAgentTurn(
      bodyOf([
        '{"type":"text","delta":"Deleting "}\n{"type":"te',
        'xt","delta":"it."}\n{"type":"tool-calls","calls":[{"toolCallId":"c1",',
        '"toolName":"deleteQuestion","input":{"questionId":7}}]}\n',
        '{"type":"client-actions","actions":[{"function":"showReportPreview","params":{}}]}\n{"type":"saved","messageId":41}',
      ]),
      (delta) => texts.push(delta),
    );

    expect(texts.join("")).toBe("Deleting it.");
    expect(turn).toEqual({
      calls: [
        {
          toolCallId: "c1",
          toolName: "deleteQuestion",
          input: { questionId: 7 },
        },
      ],
      actions: [{ function: "showReportPreview", params: {} }],
      savedMessageId: 41,
    });
  });

  it("tells agent-loop events from a plain-text reply", () => {
    const events = new Response("", {
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    });
    const text = new Response("", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });

    expect(isAgentLoopResponse(events)).toBe(true);
    expect(isAgentLoopResponse(text)).toBe(false);
  });

  it("reports each operation's outcome and the questions it touched", async () => {
    runAuthorOperationMock
      .mockResolvedValueOnce({
        success: true,
        message: "Successfully generated 2 questions.",
        questionIds: [11, 12],
      })
      .mockResolvedValueOnce({
        success: true,
        message: "Successfully deleted question 11.",
      })
      .mockRejectedValueOnce(new Error("Question with ID 99 not found"));

    const completed = await runPendingCalls([
      {
        toolCallId: "c1",
        toolName: "generateQuestionsFromObjectives",
        input: { learningObjectives: "x" },
      },
      {
        toolCallId: "c2",
        toolName: "deleteQuestion",
        input: { questionId: 11 },
      },
      {
        toolCallId: "c3",
        toolName: "modifyQuestion",
        input: { questionId: 99 },
      },
    ]);

    expect(completed.map((call) => call.output)).toEqual([
      {
        success: true,
        message: "Successfully generated 2 questions.",
        questions: [
          {
            id: 11,
            type: "SINGLE_CORRECT",
            question: "Which bone protects the brain?",
          },
          { id: 12, type: "TEXT", question: "Explain the role of enzymes." },
        ],
      },
      {
        success: true,
        message: "Successfully deleted question 11.",
        questions: undefined,
      },
      { success: false, message: "Question with ID 99 not found" },
    ]);
    expect(runAuthorOperationMock).toHaveBeenNthCalledWith(
      2,
      "deleteQuestion",
      {
        questionId: 11,
      },
    );
  });
});
