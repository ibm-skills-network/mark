"use client";
// Types only: the registry's zod schemas stay out of the browser bundle.
import type {
  AGENT_LOOP_PROTOCOL,
  ChatStreamEvent,
  OperationOutcome,
  PendingToolCall,
  StoredToolCall,
} from "mark-chat-ops";
import { runAuthorOperation } from "./authorStoreUtil";

/**
 * Browser side of the agent-loop protocol (see mark-chat-ops): read the
 * API's events, run the author operations the model called, and describe
 * what happened so the model can see it on the next request.
 */

export const AGENT_LOOP = "agent-loop-1" satisfies typeof AGENT_LOOP_PROTOCOL;

/** Continuation requests allowed per user message, so a turn always ends. */
export const MAX_CONTINUATIONS = 5;

const AGENT_LOOP_CONTENT_TYPE = "application/x-ndjson";

export interface AgentTurn {
  calls: PendingToolCall[];
  actions: Array<{ function: string; params: unknown }>;
  savedMessageId?: number;
}

/** True when the API answered with agent-loop events, not plain text. */
export function isAgentLoopResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes(
    AGENT_LOOP_CONTENT_TYPE,
  );
}

/** Reads agent-loop events, passing text to `onText` as it arrives. */
export async function readAgentTurn(
  body: ReadableStream<Uint8Array>,
  onText: (delta: string) => void,
): Promise<AgentTurn> {
  const turn: AgentTurn = { calls: [], actions: [] };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ChatStreamEvent;
    switch (event.type) {
      case "text": {
        onText(event.delta);
        break;
      }
      case "tool-calls": {
        turn.calls.push(...event.calls);
        break;
      }
      case "client-actions": {
        turn.actions.push(...event.actions);
        break;
      }
      case "saved": {
        turn.savedMessageId = event.messageId;
        break;
      }
    }
  };

  for (
    let chunk = await reader.read();
    !chunk.done;
    chunk = await reader.read()
  ) {
    buffered += decoder.decode(chunk.value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffered + decoder.decode());

  return turn;
}

/** The questions an operation touched, as they now stand in the draft. */
function questionsNow(ids: number[]): OperationOutcome["questions"] {
  if (ids.length === 0 || typeof window === "undefined") return undefined;
  const questions: any[] =
    window.authorStoreBridge?.getState()?.questions ?? [];
  const found = questions
    .filter((question) => ids.includes(question.id))
    .map((question) => ({
      id: question.id as number,
      type: String(question.type),
      question: String(question.question ?? "").slice(0, 300),
    }));
  return found.length > 0 ? found : undefined;
}

function touchedQuestionIds(call: PendingToolCall, result: any): number[] {
  if (Array.isArray(result?.questionIds)) {
    return result.questionIds.filter((id: unknown) => typeof id === "number");
  }
  const input = call.input as { questionId?: unknown };
  return call.toolName !== "deleteQuestion" &&
    typeof input?.questionId === "number"
    ? [input.questionId]
    : [];
}

/** Runs each call in the author store and records its outcome. */
export async function runPendingCalls(
  calls: PendingToolCall[],
): Promise<StoredToolCall[]> {
  const completed: StoredToolCall[] = [];
  for (const call of calls) {
    let output: OperationOutcome;
    try {
      const result: any = await runAuthorOperation(call.toolName, call.input);
      output = {
        success: true,
        message: String(result?.message ?? "Done."),
        questions: questionsNow(touchedQuestionIds(call, result)),
      };
    } catch (error) {
      output = {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    completed.push({ ...call, output });
  }
  return completed;
}
