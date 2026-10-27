import { Test } from "@nestjs/testing";
import { Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { AiFeatureFlagsService } from "../../src/api/ai-feature-flags/ai-feature-flags.service";
import { FileContentExtractionService } from "../../src/api/attempt/services/file-content-extraction";
import { FileProcessingBudgetService } from "../../src/api/files/services/file-processing-budget.service";
import { S3Service } from "../../src/api/files/services/s3.service";
import { ChatRepository } from "../../src/api/user/repositories/chat.repository";
import { ChatService } from "../../src/api/user/services/chat.service";
import { MarkChatService } from "../../src/api/user/services/mark-chat.service";
import {
  UserRole,
  UserSession,
} from "../../src/auth/interfaces/user.session.interface";
import {
  ClientOperation,
  OperationResult,
  SimulatedAuthorClient,
  SimulatedQuestion,
} from "./simulated-author-client";

/** Continuations per user message; matches MAX_CONTINUATIONS in the web client. */
const MAX_CONTINUATIONS = 5;
const AGENT_LOOP = "agent-loop-1";

interface StoredMessage {
  id: number;
  chatId: string;
  role: string;
  content: string;
  toolCalls: unknown;
}

/** Chat messages kept in memory, so stored outcomes round-trip as in the app. */
export class InMemoryChatRepository {
  readonly messages: StoredMessage[] = [];

  addMessage(
    chatId: string,
    role: string,
    content: string,
    toolCalls?: unknown,
  ) {
    const message = {
      id: this.messages.length + 1,
      chatId,
      role,
      content,
      toolCalls: toolCalls ?? null,
    };
    this.messages.push(message);
    return Promise.resolve(message);
  }

  findAssistantMessage(chatId: string, messageId: number) {
    return Promise.resolve(
      this.messages.find(
        (message) =>
          message.id === messageId &&
          message.chatId === chatId &&
          message.role === "ASSISTANT",
      ) ?? null,
    );
  }

  updateMessageToolCalls(
    chatId: string,
    messageId: number,
    toolCalls: unknown,
  ) {
    const message = this.messages.find(
      (candidate) => candidate.id === messageId && candidate.chatId === chatId,
    );
    if (message) message.toolCalls = toolCalls;
    return Promise.resolve();
  }
}

/**
 * The real MarkChatService (prompt, tools, history budgeting, streaming,
 * marker), with only storage and the logger stubbed. Whatever model
 * `ai`/`@ai-sdk/openai` resolve to is what answers.
 */
export async function createMarkChatService(
  repository: InMemoryChatRepository = new InMemoryChatRepository(),
): Promise<MarkChatService> {
  const logger = {
    child: () => logger,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  const module = await Test.createTestingModule({
    providers: [
      MarkChatService,
      { provide: S3Service, useValue: {} },
      { provide: FileContentExtractionService, useValue: {} },
      {
        provide: ChatService,
        useValue: {
          getAuthorizedChatFileLinks: () => Promise.resolve(new Set<string>()),
        },
      },
      { provide: ChatRepository, useValue: repository },
      { provide: FileProcessingBudgetService, useValue: {} },
      { provide: AiFeatureFlagsService, useValue: { isDisabled: () => false } },
      { provide: WINSTON_MODULE_PROVIDER, useValue: logger },
    ],
  }).compile();

  return module.get(MarkChatService);
}

export function authorSession(assignmentId: number): UserSession {
  return {
    userId: "mark-chat-eval@example.test",
    role: UserRole.AUTHOR,
    assignmentId,
    groupId: "mark-chat-eval",
  };
}

/** Collects what respondStream writes, the way the browser reads the stream. */
function captureResponse(): { response: Response; text: () => string } {
  const chunks: string[] = [];
  const response = {
    setHeader: () => response,
    flushHeaders: () => undefined,
    write: (chunk: string) => {
      chunks.push(String(chunk));
      return true;
    },
    end: () => response,
    status: () => response,
    send: (body: unknown) => {
      chunks.push(String(body));
      return response;
    },
  };
  return {
    response: response as unknown as Response,
    text: () => chunks.join(""),
  };
}

export interface TurnRecord {
  userText: string;
  /** Everything the assistant said this turn, across continuations. */
  reply: string;
  /** Every operation the browser ran this turn, in order. */
  operations: ClientOperation[];
  results: OperationResult[];
  before: SimulatedQuestion[];
  after: SimulatedQuestion[];
}

/**
 * One author turn as the browser runs it: send, read the events, run the
 * operations the model called, and continue with their outcomes until the
 * model stops calling operations.
 */
export async function runTurn(
  service: MarkChatService,
  client: SimulatedAuthorClient,
  userText: string,
): Promise<TurnRecord> {
  const before = client.snapshot();
  const replies: string[] = [];
  const operations: ClientOperation[] = [];
  const results: OperationResult[] = [];

  let conversation = client.conversationForSend();
  client.addUserMessage(userText);
  let request: { userText?: string; resultsForMessageId?: number } = {
    userText,
  };

  for (let round = 0; ; round++) {
    const capture = captureResponse();
    await service.respondStream(
      "mark-chat-eval",
      { userRole: "author", conversation, protocol: AGENT_LOOP, ...request },
      authorSession(client.assignmentId),
      capture.response,
    );

    const turn = client.receiveAgentTurn(capture.text());
    if (turn.reply.trim()) replies.push(turn.reply.trim());
    if (turn.calls.length === 0 || round >= MAX_CONTINUATIONS) break;

    operations.push(
      ...turn.calls.map((call) => ({
        function: call.toolName,
        params: call.input,
      })),
    );
    results.push(...client.runPendingCalls(turn.calls));

    conversation = client.conversationForSend();
    request = { resultsForMessageId: turn.savedMessageId };
  }

  return {
    userText,
    reply: replies.join("\n\n"),
    operations,
    results,
    before,
    after: client.snapshot(),
  };
}

export type ScenarioStep = { say: string } | { publish: true };

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface ScenarioRun {
  client: SimulatedAuthorClient;
  /** Seeded state, before any live step. */
  initial: SimulatedQuestion[];
  /** Live turns only, in order. Seeded history is not included. */
  turns: TurnRecord[];
}

export interface Scenario {
  id: string;
  title: string;
  /** Pass rate this scenario must reach once enforcement is on. */
  target: number;
  seed: () => SimulatedAuthorClient;
  steps: ScenarioStep[];
  check: (run: ScenarioRun) => Check[];
}

export interface RunOutcome {
  pass: boolean;
  checks: Check[];
  turns: Array<
    Pick<TurnRecord, "userText" | "reply" | "operations" | "results">
  >;
  finalQuestions: SimulatedQuestion[];
  error?: string;
}

export async function runScenarioOnce(
  service: MarkChatService,
  scenario: Scenario,
): Promise<RunOutcome> {
  const client = scenario.seed();
  const initial = client.snapshot();
  const turns: TurnRecord[] = [];

  try {
    for (const step of scenario.steps) {
      if ("publish" in step) {
        client.publish();
      } else {
        turns.push(await runTurn(service, client, step.say));
      }
    }
  } catch (error) {
    return {
      pass: false,
      checks: [],
      turns,
      finalQuestions: client.snapshot(),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const checks = scenario.check({ client, initial, turns });
  return {
    pass: checks.every((check) => check.pass),
    checks,
    turns: turns.map(({ userText, reply, operations, results }) => ({
      userText,
      reply,
      operations,
      results,
    })),
    finalQuestions: client.snapshot(),
  };
}

export interface ScenarioReport {
  id: string;
  title: string;
  target: number;
  passRate: number;
  runs: RunOutcome[];
}

export async function runScenario(
  service: MarkChatService,
  scenario: Scenario,
  runs: number,
): Promise<ScenarioReport> {
  const outcomes = await Promise.all(
    Array.from({ length: runs }, () => runScenarioOnce(service, scenario)),
  );
  const passed = outcomes.filter((outcome) => outcome.pass).length;
  return {
    id: scenario.id,
    title: scenario.title,
    target: scenario.target,
    passRate: passed / runs,
    runs: outcomes,
  };
}

/** One line per run: which checks failed and what each turn called. */
export function describeReport(report: ScenarioReport): string {
  const lines = [
    `${report.id} ${report.title}: ${Math.round(report.passRate * 100)}% (target ${Math.round(report.target * 100)}%)`,
  ];
  for (const [index, run] of report.runs.entries()) {
    const calls = run.turns
      .map(
        (turn) =>
          `[${turn.operations.map((operation) => operation.function).join(", ") || "no tools"}]`,
      )
      .join(" ");
    const failed = run.error
      ? `error: ${run.error}`
      : run.checks
          .filter((check) => !check.pass)
          .map(
            (check) =>
              `${check.name}${check.detail ? ` (${check.detail})` : ""}`,
          )
          .join("; ");
    lines.push(
      `  run ${index + 1} ${run.pass ? "PASS" : "FAIL"} ${calls}${failed ? ` -- ${failed}` : ""}`,
    );
  }
  return lines.join("\n");
}
