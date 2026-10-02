#!/usr/bin/env node
/*
 * Run from apps/api with the repository's installed dependencies:
 * node ../../scripts/benchmark-notebook-grading.js <samples.json> <results.json> [repeats]
 *
 * Samples contain rubrics and notebookBase64 downloaded through kubectl.
 * Uses the real extraction, grading, moderation, and model provider services.
 * Model assignments come from the sample snapshot; usage is recorded locally.
 * No database, shared grade cache, or object storage writes are performed.
 * Keep sample and result files outside git: they contain learner submissions.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const apiRequire = require("node:module").createRequire(
  path.resolve("package.json"),
);

apiRequire("dotenv").config({ path: path.resolve(".env"), quiet: true });
apiRequire("ts-node").register({ transpileOnly: true });
apiRequire("tsconfig-paths/register");
apiRequire("reflect-metadata");

const source = (file) => apiRequire(path.resolve("src", file));
const service = (name, area = "features/grading") =>
  source(`api/llm/${area}/services/${name}.service`);

async function main() {
  const [input, output, repeatsArg = "2"] = process.argv.slice(2);
  if (!input || !output)
    throw new Error("Provide sample and result JSON paths");
  const snapshot = JSON.parse(fs.readFileSync(input, "utf8"));
  const repeats = Number(repeatsArg);
  if (!Number.isInteger(repeats) || repeats < 1)
    throw new Error("Invalid repeats");
  const { Logger } = apiRequire("@nestjs/common");
  Logger.overrideLogger(["error"]);
  const diagnostics = [];
  const promptTrace = [];
  const logger = {
    child() {
      return this;
    },
    debug() {},
    info() {},
    log() {},
    warn(message) {
      diagnostics.push({ level: "warn", message: String(message) });
    },
    error(message) {
      diagnostics.push({ level: "error", message: String(message) });
    },
  };
  const usage = [];
  const tracker = {
    async trackUsage(
      assignmentId,
      usageType,
      inputTokens,
      outputTokens,
      model,
    ) {
      usage.push({ assignmentId, usageType, inputTokens, outputTokens, model });
    },
  };
  const { TokenCounterService } = service("token-counter", "core");
  const counter = new TokenCounterService(logger);
  const { LLMResolverService } = service("llm-resolver", "core");
  const resolver = new LLMResolverService({
    async getAssignedModel(feature) {
      return snapshot.models[feature] || null;
    },
  });
  const providerClasses = [
    service("openai-llm", "core").OpenAiLlmService,
    service("openai-llm-mini", "core").OpenAiLlmMiniService,
    service("gpt5-nano-llm", "core").Gpt5NanoLlmService,
    service("gpt5-mini-llm", "core").Gpt5MiniLlmService,
    service("gpt54-llm", "core").Gpt54MiniLlmService,
    service("gpt54-llm", "core").Gpt54NanoLlmService,
    service("gpt56-llm", "core").Gpt56LunaLlmService,
    service("gpt56-llm", "core").Gpt56SolLlmService,
    service("gpt6-luna-llm", "core").Gpt6LunaLlmService,
  ];
  const { LlmRouter } = service("llm-router", "core");
  const router = new LlmRouter(
    providerClasses.map((C) => new C(counter, logger)),
    resolver,
  );
  const { PromptProcessorService } = service("prompt-processor", "core");
  const prompt = new PromptProcessorService(
    router,
    tracker,
    { assertUsageEnabled() {} },
    logger,
  );
  if (process.env.BENCH_CAPTURE_PROMPTS === "1") {
    for (const method of [
      "processPrompt",
      "processStructuredPrompt",
      "processPromptWithImage",
    ]) {
      const invoke = prompt[method].bind(prompt);
      prompt[method] = async (template, ...args) => {
        const entry = { method, prompt: await template.format({}) };
        promptTrace.push(entry);
        entry.response = await invoke(template, ...args);
        return entry.response;
      };
    }
  }
  const { CriterionEvidenceRetrievalService } = service(
    "criterion-evidence-retrieval",
  );
  const { CriterionGradingService } = service("criterion-grading");
  const { CriterionJudgeService } = service("criterion-judge");
  const { CriterionRetryManagerService } = service("criterion-retry-manager");
  const { CriterionGradeCompilerService } = service("criterion-grade-compiler");
  const { CriterionEvidencePipelineService } = service(
    "criterion-evidence-pipeline",
  );
  const pipeline = new CriterionEvidencePipelineService(
    new CriterionEvidenceRetrievalService(prompt, resolver),
    new CriterionGradingService(prompt, resolver),
    new CriterionJudgeService(prompt, resolver),
    new CriterionRetryManagerService(),
    new CriterionGradeCompilerService(),
  );
  const { EvidenceChunkingService } = service("evidence-chunking");
  const chunking = new EvidenceChunkingService();
  const { ImageDescriptionService } = service("image-description");
  const { HighlightingGeneratorService } = service("highlighting-generator");
  const { EvidenceBasedGradingService } = service("evidence-based-grading");
  const evidence = new EvidenceBasedGradingService(
    prompt,
    new ImageDescriptionService(prompt, logger),
    new HighlightingGeneratorService(logger),
    chunking,
    pipeline,
    logger,
  );
  const { ModerationService } = service("moderation", "core");
  const { ContentSummarizationService } = service("content-summarization");
  const { PdfAnnotationService } = source(
    "api/attempt/services/pdf-annotation.service",
  );
  const { FileGradingService } = service("file-grading");
  const storage = new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error("Benchmark forbids storage I/O");
        };
      },
    },
  );
  const grader = new FileGradingService(
    prompt,
    counter,
    new ModerationService(logger),
    resolver,
    evidence,
    new PdfAnnotationService(),
    storage,
    new ContentSummarizationService(counter, prompt, logger),
    logger,
  );
  const { FileContentExtractionService } = source(
    "api/attempt/services/file-content-extraction",
  );
  const { PdfStructureExtractorService } = source(
    "api/attempt/services/pdf-structure-extractor.service",
  );
  const extraction = new FileContentExtractionService(
    storage,
    new PdfStructureExtractorService(),
  );
  const { decodeIfBase64 } = source("helpers/decoder");
  const results = {
    source: snapshot.source,
    models: snapshot.models,
    repeats,
    startedAt: new Date().toISOString(),
    revision: process.env.BENCH_REVISION,
    samples: [],
  };
  const persist = () =>
    fs.writeFileSync(output, JSON.stringify(results, null, 2), { mode: 0o600 });
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const sample of snapshot.samples) {
      if (
        process.env.BENCH_IDS &&
        !process.env.BENCH_IDS.split(",").includes(String(sample.id))
      )
        continue;
      diagnostics.length = 0;
      promptTrace.length = 0;
      usage.length = 0;
      const start = performance.now();
      const bytes = Buffer.from(sample.notebookBase64, "base64");
      const record = {
        id: sample.id,
        assignmentId: sample.assignmentId,
        assignmentName: sample.assignmentName,
        questionId: sample.questionId,
        repeat,
        checksum: crypto.createHash("sha256").update(bytes).digest("hex"),
        cells: sample.cells,
        images: sample.images,
        storedPoints: sample.storedPoints,
      };
      try {
        const [extracted] = await extraction.extractContentFromFiles(
          [
            {
              filename: sample.filename,
              content: bytes.toString("utf8"),
              fileType: "application/x-ipynb+json",
              key: "local-benchmark",
              bucket: "local-benchmark",
            },
          ],
          { provenanceShadow: false, useStructuredExtraction: true },
        );
        if (extracted.error) throw new Error(extracted.error);
        const extractionMs = performance.now() - start;
        const file = {
          ...extracted,
          key: "local-benchmark",
          bucket: "local-benchmark",
        };
        const result = await grader.gradeFileBasedQuestion(
          {
            question: decodeIfBase64(sample.question),
            learnerResponse: [file],
            totalPoints: sample.totalPoints,
            scoringCriteriaType: sample.scoring.type || "CRITERIA_BASED",
            scoringCriteria: sample.scoring,
            responseType: sample.responseType,
            questionType: sample.type,
          },
          sample.assignmentId,
          "en",
        );
        Object.assign(record, {
          extractionMs,
          durationMs: performance.now() - start,
          points: result.points,
          maxPoints: sample.totalPoints,
          rubricScores: result.rubricScores,
          feedback: result.feedback,
          metadata: result.metadata,
          usage: [...usage],
          diagnostics: [...diagnostics],
          ...(promptTrace.length ? { promptTrace: [...promptTrace] } : {}),
        });
        if (!result.rubricScores?.length)
          throw new Error("No criterion scores returned");
        if (
          diagnostics.some((d) =>
            /pipeline failed|failed to describe|error describing/i.test(
              d.message,
            ),
          )
        ) {
          throw new Error(
            "Benchmark encountered a grading or vision fallback; inspect diagnostics",
          );
        }
        console.log(
          JSON.stringify({
            id: sample.id,
            repeat,
            points: result.points,
            maxPoints: sample.totalPoints,
            images: sample.images,
            seconds: Math.round(record.durationMs / 100) / 10,
            calls: usage.length,
          }),
        );
      } catch (error) {
        record.error = String(error.message);
        record.diagnostics = [...diagnostics];
        record.usage = [...usage];
        process.exitCode = 1;
        console.error(`Sample ${sample.id}: ${record.error}`);
      }
      results.samples.push(record);
      persist();
      if (record.error) return;
    }
  }
  results.completedAt = new Date().toISOString();
  persist();
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
