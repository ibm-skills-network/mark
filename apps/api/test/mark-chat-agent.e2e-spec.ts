/**
 * Behavioural evals for the author-mode Mark chat agent: scripted
 * conversations against the real model, scored on the tool calls made and the
 * draft they leave behind. Scenarios and targets: test/mark-chat-eval/scenarios.ts
 * and docs/plan-mark-chat-agent-loop.md.
 *
 * Calls the model for real, so it is skipped unless RUN_MARK_CHAT_EVAL=true
 * and needs OPENAI_API_KEY (MARK_CHAT_MODEL picks the model, as in the app).
 * By default it only reports pass rates; MARK_CHAT_EVAL_ENFORCE=true fails a
 * scenario that misses its target.
 *
 * Run (from apps/api):
 *   RUN_MARK_CHAT_EVAL=true dotenv -e ./dev.env -- yarn test:e2e --runTestsByPath test/mark-chat-agent.e2e-spec.ts
 *
 * Options:
 *   MARK_CHAT_EVAL_RUNS=5           runs per scenario
 *   MARK_CHAT_EVAL_SCENARIOS=S2,S4  only these scenarios
 *   MARK_CHAT_EVAL_REPORT=path.json where to write the full transcripts
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { MarkChatService } from "../src/api/user/services/mark-chat.service";
import {
  createMarkChatService,
  describeReport,
  runScenario,
  ScenarioReport,
} from "./mark-chat-eval/harness";
import { SCENARIOS } from "./mark-chat-eval/scenarios";

// The harness stubs file extraction; skip loading pdfjs (ESM) and canvas.
jest.mock("../src/api/attempt/services/file-content-extraction", () => ({
  FileContentExtractionService: class {},
}));

const RUN = process.env.RUN_MARK_CHAT_EVAL === "true";
const ENFORCE = process.env.MARK_CHAT_EVAL_ENFORCE === "true";
const RUNS = Math.max(1, Number(process.env.MARK_CHAT_EVAL_RUNS) || 5);
const ONLY = new Set(
  (process.env.MARK_CHAT_EVAL_SCENARIOS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
const REPORT_PATH =
  process.env.MARK_CHAT_EVAL_REPORT ??
  path.join(tmpdir(), `mark-chat-eval-${Date.now()}.json`);
const SCENARIO_TIMEOUT_MS = 10 * 60 * 1000;

const selected = SCENARIOS.filter(
  (scenario) => ONLY.size === 0 || ONLY.has(scenario.id),
);

(RUN ? describe : describe.skip)("Mark chat agent evals (live model)", () => {
  let service: MarkChatService;
  const reports: ScenarioReport[] = [];

  beforeAll(async () => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for the Mark chat evals");
    }
    service = await createMarkChatService();
  });

  afterAll(() => {
    if (reports.length === 0) return;

    writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          model: process.env.MARK_CHAT_MODEL ?? "default",
          runsPerScenario: RUNS,
          reports,
        },
        undefined,
        2,
      ),
    );

    const summary = reports.map(
      (report) =>
        `${report.passRate >= report.target ? "MET " : "MISS"} ${report.id.padEnd(3)} ${`${Math.round(report.passRate * 100)}%`.padStart(4)} / ${Math.round(report.target * 100)}%  ${report.title}`,
    );
    console.log(
      `Mark chat evals (${RUNS} runs each)\n${summary.join("\n")}\nTranscripts: ${REPORT_PATH}`,
    );
  });

  for (const scenario of selected) {
    it(
      `${scenario.id}: ${scenario.title}`,
      async () => {
        const report = await runScenario(service, scenario, RUNS);
        reports.push(report);
        console.log(describeReport(report));

        if (ENFORCE) {
          expect(report.passRate).toBeGreaterThanOrEqual(scenario.target);
        }
      },
      SCENARIO_TIMEOUT_MS,
    );
  }
});
