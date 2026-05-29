import { resolveMaxEvidenceBlocksPerSubmission } from "../constants";

describe("resolveMaxEvidenceBlocksPerSubmission", () => {
  const ENV_KEY = "GRADING_MAX_EVIDENCE_BLOCKS";
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it("defaults to 50000 when the env var is unset", () => {
    delete process.env[ENV_KEY];
    expect(resolveMaxEvidenceBlocksPerSubmission()).toBe(50_000);
  });

  it("uses a valid positive override", () => {
    process.env[ENV_KEY] = "20000";
    expect(resolveMaxEvidenceBlocksPerSubmission()).toBe(20_000);
  });

  it("falls back to 50000 for non-numeric values", () => {
    process.env[ENV_KEY] = "lots";
    expect(resolveMaxEvidenceBlocksPerSubmission()).toBe(50_000);
  });

  it("falls back to 50000 for an empty string", () => {
    process.env[ENV_KEY] = "";
    expect(resolveMaxEvidenceBlocksPerSubmission()).toBe(50_000);
  });

  it("falls back to 50000 for zero or negative values", () => {
    process.env[ENV_KEY] = "0";
    expect(resolveMaxEvidenceBlocksPerSubmission()).toBe(50_000);
    process.env[ENV_KEY] = "-100";
    expect(resolveMaxEvidenceBlocksPerSubmission()).toBe(50_000);
  });
});
