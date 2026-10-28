/**
 * Local spike runner: grade a directory of cases with the same code the
 * bridge uses, and print tokens, cost and latency per run.
 *
 *   cd apps/api
 *   npx ts-node -r tsconfig-paths/register src/v3/grading/evals/spike-runner.ts \
 *     --cases ../../spike/cases --effort low,medium --runs 3 --max-cost 2 --out results.json
 *
 * Case file (one JSON per case):
 *   { "caseId": "...", "input": <GradingInput without parts>,
 *     "files": [{ "name": "a.xlsx", "path": "a.xlsx", "mimeType": "..." }],
 *     "responseText": "...", "urls": ["https://..."] }
 * File paths are relative to the case file. --dry-run materializes and
 * estimates without calling the model. Needs OPENAI_API_KEY otherwise.
 * --debug asks the model for its reasoning summary and writes each run's
 * debug block (parts sent, raw output, quote checks) into the results file;
 * with --dry-run it writes the parts list only. --no-render skips the
 * LibreOffice page renders (pptx, docx, xlsx chart sheets) to compare.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type EvidenceCounts,
  type GradingDebug,
  type GradingEffort,
  gradingEffortSchema,
  type GradingLogger,
  type GradingOutcome,
  gradingQuestionSchema,
} from "../contracts";
import { fetchUrlAsParts } from "../fetch-url";
import { createRenderer } from "../formats/render";
import { gradeWithV3 } from "../grade-question";
import { htmlToMarkdown, looksLikeHtml } from "../html-text";
import { estimateCallCostUsd, estimateCostUsd } from "../limits";
import {
  estimatePartTokens,
  materialize,
  type SubmissionFile,
} from "../materialize";
import { OpenAiGradingModelClient } from "../model-client";

const caseSchema = z.object({
  caseId: z.string().min(1),
  input: gradingQuestionSchema
    .omit({ effort: true })
    .extend({ effort: gradingEffortSchema.optional() }),
  files: z
    .array(
      z.object({
        name: z.string().min(1),
        path: z.string().min(1),
        mimeType: z.string().optional(),
      }),
    )
    .default([]),
  responseText: z.string().optional(),
  urls: z.array(z.string()).default([]),
});
type SpikeCase = z.infer<typeof caseSchema>;

interface Options {
  casesDirectory: string;
  efforts: GradingEffort[];
  runs: number;
  dryRun: boolean;
  maxCostUsd: number;
  out: string;
  model?: string;
  verbose: boolean;
  debug: boolean;
  render: boolean;
}

function parseArguments(argv: string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const casesDirectory = value("--cases");
  if (!casesDirectory) {
    throw new Error(
      "usage: spike-runner --cases <dir> [--effort low,medium] [--runs 1] [--dry-run] [--max-cost 1] [--out file] [--model id] [--verbose] [--debug] [--no-render]",
    );
  }
  const efforts = (value("--effort") ?? "low")
    .split(",")
    .map((effort) => gradingEffortSchema.parse(effort.trim()));
  const runs = Number.parseInt(value("--runs") ?? "1", 10);
  const maxCostUsd = Number.parseFloat(value("--max-cost") ?? "1");
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error("--runs must be >= 1");
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error("--max-cost must be a positive number of dollars");
  }
  return {
    casesDirectory,
    efforts,
    runs,
    dryRun: argv.includes("--dry-run"),
    maxCostUsd,
    out: value("--out") ?? `spike-results-${Date.now()}.json`,
    model: value("--model"),
    verbose: argv.includes("--verbose"),
    debug: argv.includes("--debug"),
    render: !argv.includes("--no-render"),
  };
}

function stderrWriter(level: string, enabled: boolean) {
  return (message: string, meta?: Record<string, unknown>) => {
    if (enabled) {
      process.stderr.write(`${JSON.stringify({ level, message, ...meta })}\n`);
    }
  };
}

function stderrLogger(verbose: boolean): GradingLogger {
  const write = stderrWriter;
  return {
    debug: write("debug", verbose),
    info: write("info", verbose),
    warn: write("warn", true),
    error: write("error", true),
  };
}

async function loadCases(
  directory: string,
): Promise<Array<{ file: string; spikeCase: SpikeCase }>> {
  const entries = await readdir(directory);
  const names = entries.filter((name) => name.endsWith(".json")).sort();
  const cases: Array<{ file: string; spikeCase: SpikeCase }> = [];
  for (const name of names) {
    const file = path.join(directory, name);
    const raw = await readFile(file, "utf8");
    const parsed = caseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `${name}: not a valid case (${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")})`,
      );
    }
    cases.push({ file, spikeCase: parsed.data });
  }
  return cases;
}

function caseFiles(caseFile: string, spikeCase: SpikeCase): SubmissionFile[] {
  const base = path.dirname(caseFile);
  return spikeCase.files.map((entry) => {
    const full = path.resolve(base, entry.path);
    return {
      name: entry.name,
      mimeType: entry.mimeType,
      load: () => readFile(full),
      size: undefined,
    };
  });
}

interface NeedsVerificationSummary {
  count: number;
  reasons: Array<{ criterionId: string; reason: string | null }>;
}

function needsVerificationOf(
  outcome: GradingOutcome,
): NeedsVerificationSummary | undefined {
  if (outcome.status !== "graded") return undefined;
  const flagged = outcome.result.verdicts.filter(
    (verdict) => verdict.needsVerification,
  );
  return {
    count: flagged.length,
    reasons: flagged.map((verdict) => ({
      criterionId: verdict.criterionId,
      reason: verdict.verificationReason,
    })),
  };
}

interface RunRow {
  caseId: string;
  effort: GradingEffort;
  run: number;
  status: string;
  points: string;
  checkFailures: number;
  /** Kept quotes: confirmed against text, or visual and unconfirmed. */
  evidence?: EvidenceCounts;
  /** Criteria the model could not decide without running or computing. */
  needsVerification?: NeedsVerificationSummary;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estimatedTokens: number;
  costUsd: number;
  latencyMs: number;
  outcome?: GradingOutcome;
  materializeError?: string;
  debug?: GradingDebug | Pick<GradingDebug, "parts">;
}

function printTable(rows: RunRow[]): void {
  const header = [
    "case",
    "effort",
    "run",
    "status",
    "points",
    "checks",
    "ev ok/vis",
    "verify",
    "in",
    "cached",
    "out",
    "reason",
    "est",
    "cost$",
    "ms",
  ];
  const lines = rows.map((row) => [
    row.caseId,
    row.effort,
    String(row.run),
    row.status,
    row.points,
    String(row.checkFailures),
    row.evidence
      ? `${row.evidence.verified}/${row.evidence.visualUnverified}`
      : "-",
    row.needsVerification ? String(row.needsVerification.count) : "-",
    String(row.inputTokens),
    String(row.cachedInputTokens),
    String(row.outputTokens),
    String(row.reasoningTokens),
    String(row.estimatedTokens),
    row.costUsd.toFixed(5),
    String(row.latencyMs),
  ]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...lines.map((line) => line[index].length)),
  );
  const format = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  process.stdout.write(`${format(header)}\n`);
  for (const line of lines) process.stdout.write(`${format(line)}\n`);
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
  process.stdout.write(
    `\ntotal cost $${total.toFixed(5)} over ${rows.length} run(s)\n`,
  );
  const flagged = rows.filter((row) => (row.needsVerification?.count ?? 0) > 0);
  if (flagged.length > 0) {
    process.stdout.write("\nneeds verification:\n");
    for (const row of flagged) {
      process.stdout.write(
        `  ${row.caseId} ${row.effort} run ${row.run}: ${row.needsVerification?.count} criterion(s)\n`,
      );
      for (const item of row.needsVerification?.reasons ?? []) {
        process.stdout.write(
          `    - ${item.criterionId}: ${item.reason ?? "(no reason given)"}\n`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const casesStat = await stat(options.casesDirectory);
  if (!casesStat.isDirectory()) {
    throw new Error(`${options.casesDirectory} is not a directory`);
  }
  const logger = stderrLogger(options.verbose);
  const cases = await loadCases(options.casesDirectory);
  const renderer = options.render ? createRenderer({ logger }) : undefined;
  const client = options.dryRun
    ? undefined
    : new OpenAiGradingModelClient({ model: options.model });
  const rows: RunRow[] = [];
  let spentUsd = 0;
  let aborted = false;

  for (const { file, spikeCase } of cases) {
    const materialized = await materialize(
      {
        // Same conversion the bridge applies to rich-text answers.
        text:
          spikeCase.responseText !== undefined &&
          looksLikeHtml(spikeCase.responseText)
            ? htmlToMarkdown(spikeCase.responseText)
            : spikeCase.responseText,
        files: caseFiles(file, spikeCase),
        urls: spikeCase.urls,
        questionContext: [
          spikeCase.input.questionText,
          ...spikeCase.input.rubric.criteria.map(
            (criterion) => criterion.description,
          ),
        ].join("\n"),
      },
      {
        fetchUrl: (url) => fetchUrlAsParts(url, undefined, logger),
        ...(renderer ? { renderer } : {}),
      },
    );
    for (const effort of options.efforts) {
      const blank = {
        caseId: spikeCase.caseId,
        effort,
        checkFailures: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        latencyMs: 0,
      };
      if (materialized.ok === false) {
        rows.push({
          ...blank,
          run: 0,
          status: `materialize:${materialized.code}`,
          points: "-",
          estimatedTokens: materialized.estimatedTokens ?? 0,
          materializeError: materialized.message,
        });
        continue;
      }
      const estimatedTokens = materialized.estimatedTokens;
      if (options.dryRun || !client) {
        rows.push({
          ...blank,
          run: 0,
          status: `dry-run parts=${materialized.parts.length} sent=${materialized.stats.filesSent} skipped=${materialized.stats.filesSkipped}`,
          points: "-",
          estimatedTokens,
          costUsd: estimateCallCostUsd(estimatedTokens),
          ...(options.debug
            ? {
                debug: {
                  parts: materialized.parts.map((part) => ({
                    name: part.name,
                    kind: part.kind,
                    ...(part.mimeType ? { mimeType: part.mimeType } : {}),
                    estimatedTokens: estimatePartTokens(part),
                  })),
                },
              }
            : {}),
        });
        continue;
      }
      for (let run = 1; run <= options.runs; run += 1) {
        // Worst case for this run includes a retry.
        const worstCase = 2 * estimateCallCostUsd(estimatedTokens);
        if (spentUsd + worstCase > options.maxCostUsd) {
          process.stderr.write(
            `aborting: spent $${spentUsd.toFixed(4)}, next run could cost $${worstCase.toFixed(4)}, max $${options.maxCostUsd}\n`,
          );
          aborted = true;
          break;
        }
        const started = Date.now();
        const outcome = await gradeWithV3(
          {
            ...spikeCase.input,
            effort,
            parts: materialized.parts,
          },
          {
            client,
            logger,
            context: { questionId: spikeCase.input.questionId, mode: "spike" },
            debug: options.debug,
          },
        );
        const debug =
          outcome.status === "graded"
            ? outcome.result.debug
            : outcome.failure.debug;
        const usage =
          outcome.status === "graded"
            ? outcome.result.usage
            : outcome.failure.usage;
        const costUsd = estimateCostUsd(usage);
        spentUsd += costUsd;
        rows.push({
          ...blank,
          run,
          status: outcome.status === "graded" ? "graded" : outcome.failure.code,
          points:
            outcome.status === "graded"
              ? `${outcome.result.totalPoints}/${spikeCase.input.totalPoints}`
              : "-",
          checkFailures:
            outcome.status === "graded"
              ? outcome.result.checkFailures.length
              : outcome.failure.checkFailures.length,
          ...(outcome.status === "graded"
            ? {
                evidence: outcome.result.evidence,
                needsVerification: needsVerificationOf(outcome),
              }
            : {}),
          ...usage,
          estimatedTokens,
          costUsd,
          latencyMs: Date.now() - started,
          outcome,
          ...(debug ? { debug } : {}),
        });
      }
      if (aborted) break;
    }
    if (aborted) break;
  }

  printTable(rows);
  await writeFile(
    options.out,
    JSON.stringify({ options, spentUsd, aborted, rows }, undefined, 2),
  );
  process.stdout.write(`results written to ${options.out}\n`);
  if (aborted) process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
