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

/**
 * The real MarkChatService (prompt, tools, history budgeting, streaming,
 * marker), with only storage and the logger stubbed. Whatever model
 * `ai`/`@ai-sdk/openai` resolve to is what answers.
 */
export async function createMarkChatService(): Promise<MarkChatService> {
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
      {
        provide: ChatRepository,
        useValue: { addMessage: () => Promise.resolve({ id: "eval" }) },
      },
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
  reply: string;
  operations: ClientOperation[];
  results: OperationResult[];
  before: SimulatedQuestion[];
  after: SimulatedQuestion[];
}

/** One author turn: send, stream the reply, run the operations client-side. */
export async function runTurn(
  service: MarkChatService,
  client: SimulatedAuthorClient,
  userText: string,
): Promise<TurnRecord> {
  const before = client.snapshot();
  const conversation = client.conversationForSend();
  client.addUserMessage(userText);

  const capture = captureResponse();
  await service.respondStream(
    "mark-chat-eval",
    { userRole: "author", userText, conversation },
    authorSession(client.assignmentId),
    capture.response,
  );

  const { reply, operations } = client.receiveAssistantReply(capture.text());
  const results = client.executeOperations(operations);
  return {
    userText,
    reply,
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
