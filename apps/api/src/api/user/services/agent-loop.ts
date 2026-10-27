import { ModelMessage } from "ai";
import {
  AUTHOR_OPERATIONS,
  AuthorOperationName,
  OperationOutcome,
  PendingToolCall,
  StoredToolCall,
} from "mark-chat-ops";

/**
 * Helpers for the agent-loop protocol (see mark-chat-ops): the browser runs
 * the author operations the model calls and reports their outcomes, which are
 * stored on the assistant message that made the calls and replayed to the
 * model as tool results. Everything here reads browser-supplied data, so it
 * keeps only the fields it knows and bounds their size.
 */

const MAX_OUTCOME_MESSAGE_CHARS = 2000;
const MAX_OUTCOME_QUESTIONS = 50;
const MAX_QUESTION_TEXT_CHARS = 300;

const LEGACY_MARKER = /<!-- CLIENT_EXECUTION_MARKER\n[\S\s]*?\n-->/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAuthorOperationName(
  name: unknown,
): name is AuthorOperationName {
  return typeof name === "string" && Object.hasOwn(AUTHOR_OPERATIONS, name);
}

/** Keeps the known outcome fields, trimmed; undefined if it isn't one. */
export function sanitizeOutcome(value: unknown): OperationOutcome | undefined {
  if (!isRecord(value) || typeof value.success !== "boolean") return undefined;

  const outcome: OperationOutcome = {
    success: value.success,
    message:
      typeof value.message === "string"
        ? value.message.slice(0, MAX_OUTCOME_MESSAGE_CHARS)
        : "",
  };

  if (Array.isArray(value.questions)) {
    outcome.questions = value.questions
      .filter(
        (question): question is Record<string, unknown> =>
          isRecord(question) && typeof question.id === "number",
      )
      .slice(0, MAX_OUTCOME_QUESTIONS)
      .map((question) => ({
        id: question.id as number,
        type: typeof question.type === "string" ? question.type : "UNKNOWN",
        question:
          typeof question.question === "string"
            ? question.question.slice(0, MAX_QUESTION_TEXT_CHARS)
            : "",
      }));
  }

  return outcome;
}

/**
 * The agent-loop entries of a message's `toolCalls`. Other entries (file
 * chips, older `{ function, params }` rows) are skipped.
 */
export function readStoredToolCalls(toolCalls: unknown): StoredToolCall[] {
  if (!Array.isArray(toolCalls)) return [];

  const calls: StoredToolCall[] = [];
  for (const entry of toolCalls) {
    if (
      !isRecord(entry) ||
      typeof entry.toolCallId !== "string" ||
      !isAuthorOperationName(entry.toolName)
    ) {
      continue;
    }
    const output = sanitizeOutcome(entry.output);
    calls.push({
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      input: entry.input ?? {},
      ...(output ? { output } : {}),
    });
  }
  return calls;
}

/** Assistant text as the model should see it again. */
export function assistantText(content: string): string {
  return content.replaceAll(LEGACY_MARKER, "").trim();
}

/**
 * An assistant message as model messages: its text and the calls it made,
 * followed by their results. Calls with no stored outcome are left out (the
 * browser never reported back), so every call sent has a result.
 */
export function assistantModelMessages(
  content: string,
  toolCalls: unknown,
): ModelMessage[] {
  const text = assistantText(content);
  const completed = readStoredToolCalls(toolCalls).filter(
    (call) => call.output !== undefined,
  );

  if (completed.length === 0) {
    return [{ role: "assistant", content: text }];
  }

  return [
    {
      role: "assistant",
      content: [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...completed.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })),
      ],
    },
    {
      role: "tool",
      content: completed.map((call) => ({
        type: "tool-result" as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: "json" as const, value: call.output as never },
      })),
    },
  ];
}

interface StepLike {
  toolCalls?: ReadonlyArray<{
    toolCallId: string;
    toolName: string;
    input?: unknown;
  }>;
  content?: ReadonlyArray<{ type: string; toolCallId?: string }>;
}

/**
 * Author operations the model called in its last step that still need the
 * browser. A call the SDK already answered (e.g. input that failed the
 * schema, which it returns to the model as a tool error) is not pending.
 */
export function pendingToolCalls(
  steps: ReadonlyArray<StepLike | undefined> | undefined,
): PendingToolCall[] {
  const lastStep = steps?.at(-1);
  if (!lastStep?.toolCalls) return [];

  const answered = new Set(
    (lastStep.content ?? [])
      .filter(
        (part) => part.type === "tool-result" || part.type === "tool-error",
      )
      .map((part) => part.toolCallId),
  );

  return lastStep.toolCalls
    .filter(
      (call) =>
        isAuthorOperationName(call.toolName) && !answered.has(call.toolCallId),
    )
    .map((call) => ({
      toolCallId: call.toolCallId,
      toolName: call.toolName as AuthorOperationName,
      input: call.input ?? {},
    }));
}

/**
 * Stored calls with the browser's outcomes attached. Only calls already on
 * the stored message take an outcome, so a browser cannot add calls the model
 * never made; an outcome already stored is not overwritten.
 */
export function attachOutcomes(
  storedToolCalls: unknown,
  reported: StoredToolCall[],
): { toolCalls: unknown[]; attached: number } {
  if (!Array.isArray(storedToolCalls)) return { toolCalls: [], attached: 0 };

  const outcomes = new Map(
    reported
      .filter((call) => call.output !== undefined)
      .map((call) => [call.toolCallId, call.output]),
  );

  let attached = 0;
  const toolCalls = storedToolCalls.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.toolCallId !== "string" ||
      entry.output !== undefined ||
      !outcomes.has(entry.toolCallId)
    ) {
      return entry;
    }
    attached += 1;
    return { ...entry, output: outcomes.get(entry.toolCallId) };
  });

  return { toolCalls, attached };
}
