const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseCanonicalArtifact,
  ArtifactContractError,
  canReuseArtifact,
  artifactFormatCapabilities,
} = require("../dist");
const sourceId = "dca62079-20c0-4efb-a6c3-8d175deac996";
function fixture() {
  const text = "First page\n" + "x".repeat(400) + "\nLate decisive evidence: Ω";
  return {
    schemaVersion: 1,
    artifactId: "3fe9c599-c753-4a16-b0b4-8107373e63a6",
    source: {
      sourceId,
      attemptId: 42,
      checksum: "a".repeat(64),
      byteSize: 1000,
      mediaType: "application/pdf",
    },
    extractor: { name: "pdf", version: "1", configHash: "b".repeat(64) },
    createdAt: "2026-10-22T12:00:00.000Z",
    status: "success",
    blocks: [
      { id: sourceId + ":page:12", kind: "text", text, location: { page: 12 } },
    ],
    metrics: {
      inputBytes: 1000,
      expandedBytes: 1500,
      outputBytes: 1200,
      textCharacters: text.length,
      blockCount: 1,
      durationMs: 5,
    },
    omissions: [],
  };
}
test("canonical artifacts preserve late evidence, exact identity and locations through serialization", () => {
  const input = fixture();
  assert.deepEqual(
    parseCanonicalArtifact(JSON.parse(JSON.stringify(input))),
    input,
  );
  assert.match(
    parseCanonicalArtifact(input).blocks[0].text,
    /Late decisive evidence: Ω$/,
  );
});
test("strict manifests reject dishonest success, metrics, versions and foreign block identities", () => {
  for (const mutate of [
    (a) => (a.schemaVersion = 2),
    (a) => (a.secret = "cookie"),
    (a) => a.metrics.blockCount++,
    (a) => a.metrics.textCharacters++,
    (a) => a.metrics.inputBytes++,
    (a) => a.blocks.push(a.blocks[0]),
    (a) => (a.blocks[0].id = "foreign:page:12"),
    (a) => (a.blocks[0].location.lineEnd = 1),
    (a) => a.omissions.push({ code: "missing_visual_evidence" }),
    (a) => (a.source.attemptId = 0),
    (a) => (a.source.checksum = "unchecked"),
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => parseCanonicalArtifact(input), ArtifactContractError);
  }
});
test("partial output records missing visuals and never silently becomes success", () => {
  const input = fixture();
  input.status = "partial";
  input.omissions.push({
    code: "missing_visual_evidence",
    location: { page: 12 },
  });
  assert.equal(parseCanonicalArtifact(input).status, "partial");
  input.omissions = [];
  assert.throws(() => parseCanonicalArtifact(input));
});
test("empty, failed and unsupported are distinct and bounded safe errors do not leak evidence", () => {
  const input = fixture();
  input.blocks = [];
  input.metrics.blockCount = 0;
  input.metrics.textCharacters = 0;
  input.status = "empty";
  assert.equal(parseCanonicalArtifact(input).status, "empty");
  input.status = "failed";
  assert.throws(() => parseCanonicalArtifact(input));
  input.failure = { code: "timeout", retryable: true };
  assert.equal(parseCanonicalArtifact(input).failure.code, "timeout");
  input.status = "unsupported";
  assert.throws(() => parseCanonicalArtifact(input));
  input.failure = { code: "unsupported_format", retryable: false };
  assert.equal(parseCanonicalArtifact(input).status, "unsupported");
  input.secret = "TOP-SECRET";
  assert.throws(
    () => parseCanonicalArtifact(input),
    (error) =>
      !error.message.includes("TOP-SECRET") && error.retryable === false,
  );
});
test("reusing checkpoints requires source scope, bytes and complete extractor configuration identity", () => {
  const a = fixture();
  assert.equal(canReuseArtifact(a, a.source, a.extractor), true);
  for (const change of [
    { attemptId: 43 },
    { sourceId: "54b68ac3-c9d0-473e-baf9-a973ae28e947" },
    { checksum: "c".repeat(64) },
    { byteSize: 999 },
  ])
    assert.equal(
      canReuseArtifact(a, { ...a.source, ...change }, a.extractor),
      false,
    );
  for (const change of [
    { name: "other" },
    { version: "2" },
    { configHash: "c".repeat(64) },
  ])
    assert.equal(
      canReuseArtifact(a, a.source, { ...a.extractor, ...change }),
      false,
    );
  a.status = "failed";
  assert.equal(canReuseArtifact(a, a.source, a.extractor), false);
});
test("format inventory does not imply gradeability from an extension or enable an untested adapter", () => {
  assert.equal(
    new Set(artifactFormatCapabilities.map((c) => c.format)).size,
    10,
  );
  for (const capability of artifactFormatCapabilities) {
    assert.equal(capability.canonicalAccepted, false);
    assert.equal(capability.extractable, false);
    assert.equal(capability.gradeability, "requires-evidence-gate");
    assert.ok(capability.limitations.length);
  }
});
