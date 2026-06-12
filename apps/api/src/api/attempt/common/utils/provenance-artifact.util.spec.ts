import * as crypto from "node:crypto";
import { provenanceArtifactKey } from "./provenance-artifact.util";

describe("provenanceArtifactKey", () => {
  it("is deterministic: same input yields the same key", () => {
    const file = { recordId: 42, questionId: 7, filename: "report.pdf" };
    expect(provenanceArtifactKey(file)).toBe(provenanceArtifactKey(file));
  });

  it("uses recordId as the prefix when present", () => {
    const key = provenanceArtifactKey({
      recordId: 42,
      questionId: 7,
      filename: "report.pdf",
    });
    expect(key.startsWith("provenance/42/7/")).toBe(true);
  });

  it("falls back to questionId for the prefix when recordId is absent", () => {
    const key = provenanceArtifactKey({
      questionId: 7,
      filename: "report.pdf",
    });
    expect(key.startsWith("provenance/7/7/")).toBe(true);
  });

  it("falls back to 'unknown' prefix and 'na' question when both ids are absent", () => {
    const key = provenanceArtifactKey({ filename: "report.pdf" });
    expect(key.startsWith("provenance/unknown/na/")).toBe(true);
  });

  it("accepts a string recordId", () => {
    const key = provenanceArtifactKey({
      recordId: "abc-123",
      questionId: 5,
      filename: "report.pdf",
    });
    expect(key.startsWith("provenance/abc-123/5/")).toBe(true);
  });

  it("never embeds the raw filename in the key", () => {
    const filename = "secret-learner-name.pdf";
    const key = provenanceArtifactKey({
      recordId: 1,
      questionId: 2,
      filename,
    });
    expect(key).not.toContain(filename);
    expect(key).not.toContain("secret-learner-name");
  });

  it("embeds a 32-char sha256 hash of the filename and ends in .json", () => {
    const filename = "report.pdf";
    const key = provenanceArtifactKey({
      recordId: 1,
      questionId: 2,
      filename,
    });
    const expectedHash = crypto
      .createHash("sha256")
      .update(filename)
      .digest("hex")
      .slice(0, 32);
    expect(key).toBe(`provenance/1/2/${expectedHash}.json`);
  });

  it("produces different keys for different filenames", () => {
    const a = provenanceArtifactKey({
      recordId: 1,
      questionId: 2,
      filename: "a.pdf",
    });
    const b = provenanceArtifactKey({
      recordId: 1,
      questionId: 2,
      filename: "b.pdf",
    });
    expect(a).not.toBe(b);
  });
});
