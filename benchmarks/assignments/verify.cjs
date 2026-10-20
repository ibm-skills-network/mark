// Run explicitly: node --test benchmarks/assignments/verify.cjs
// No provider calls. This checks the harness, not grading quality.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { buildSuite, code } = require("./fixtures.cjs");
const { fingerprint, evaluate, ordering, compare } = require("./report.cjs");
const { localUrl, options, validate } = require("./cli.cjs");
const suitePromise = buildSuite();
test("fixtures are complete and byte-reproducible", async () => {
  const s = await suitePromise;
  await validate(s);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.equal(fingerprint(s), fingerprint(await buildSuite()));
});
test("200-character truncation cannot distinguish the paired source submissions", async () => {
  assert.equal(code[0].slice(0, 200), code[2].slice(0, 200));
  const q = (await suitePromise).assignments.find((a) => a.key === "software")
    .questions[0];
  // A grader seeing only the shared prefix and giving both the same score must fail a band.
  for (let score = 0; score <= 12; score++)
    assert.ok(
      evaluate(q, 0, { points: score, feedback: "Example feedback" }).length ||
        evaluate(q, 2, { points: score, feedback: "Example feedback" }).length,
    );
});
test("missing scores, inverted tiers, and incompatible comparisons fail", async () => {
  const q = (await suitePromise).assignments[0].questions[0];
  assert.ok(evaluate(q, 0, null).length);
  assert.ok(evaluate(q, 2, { points: 0 }).length);
  assert.equal(
    ordering(
      ["poor", "mediocre", "great"].map((tier, i) => ({
        assignment: "x",
        repeat: 1,
        tier,
        grade: 1 - i / 2,
      })),
    ).length,
    1,
  );
  assert.throws(() => compare({ suiteHash: "a" }, { suiteHash: "b" }));
  const report = {
    suiteHash: "a",
    model: "gpt-6-luna",
    completedAt: "now",
    records: [
      {
        assignment: "x",
        tier: "great",
        repeat: 1,
        grade: 1,
        durationMs: 100,
        errors: [],
        questions: [{ key: "q", points: 12 }],
      },
    ],
  };
  const after = structuredClone(report);
  after.records[0].grade = 0.5;
  assert.equal(compare(report, after)[0].gradeDelta, -0.5);
  assert.throws(() => compare(report, { ...report, records: [] }));
});
test("production targets and invalid CLI options are refused", () => {
  assert.throws(() => localUrl("https://mark.example.com", "API"));
  assert.throws(() => localUrl("http://127.0.0.1.evil.example", "API"));
  assert.throws(() => options(["--typo", "foo"]));
  assert.equal(localUrl("http://127.0.0.1:4222", "API").port, "4222");
});
test("real Mark extractors retain late evidence in generated formats", async () => {
  const apiRoot = path.resolve(__dirname, "../../apps/api");
  const r = createRequire(path.join(apiRoot, "package.json"));
  r("ts-node").register({
    transpileOnly: true,
    project: path.join(apiRoot, "tsconfig.json"),
  });
  r("tsconfig-paths").register({
    baseUrl: apiRoot,
    paths: { "src/*": ["src/*"] },
  });
  r("reflect-metadata");
  r("@nestjs/common").Logger.overrideLogger(["error"]);
  const { FileContentExtractionService } = r(
    path.join(apiRoot, "src/api/attempt/services/file-content-extraction"),
  );
  const { PdfStructureExtractorService } = r(
    path.join(
      apiRoot,
      "src/api/attempt/services/pdf-structure-extractor.service",
    ),
  );
  const storage = new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error("Offline verification must not access storage");
        };
      },
    },
  );
  const extractor = new FileContentExtractionService(
    storage,
    new PdfStructureExtractorService(),
  );
  const s = await suitePromise;
  for (const [ext, needle] of [
    ["py", "raise ValueError"],
    ["zip", "raise ValueError"],
    ["xlsx", "-125"],
    ["ipynb", "12.5"],
    ["docx", "7 days"],
    ["pptx", "reconcile"],
    ["pdf", "7 days"],
  ]) {
    const asset = s.assets[`great.${ext}`];
    const [result] = await extractor.extractContentFromFiles(
      [
        {
          filename: `submission.${ext}`,
          content: "",
          buffer: asset.bytes,
          bucket: "offline",
          key: "offline",
          fileType: asset.mime,
        },
      ],
      { provenanceShadow: false, useStructuredExtraction: true },
    );
    assert.ok(!result.error, `${ext}: ${result.error}`);
    assert.ok(
      JSON.stringify(result).includes(needle),
      `${ext}: late evidence ${needle} disappeared`,
    );
  }
});
