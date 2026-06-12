import { provenanceArtifactKey } from "./provenance-artifact.util";

describe("provenanceArtifactKey", () => {
  it("is deterministic: same input yields the same key", () => {
    const file = { key: "1/learner@example.com/7/report.pdf" };
    expect(provenanceArtifactKey(file)).toBe(provenanceArtifactKey(file));
  });

  it("derives the key from the source object's own storage key", () => {
    const key = provenanceArtifactKey({
      key: "1/learner@example.com/7/report.pdf",
    });
    expect(key).toBe("provenance/1/learner@example.com/7/report.pdf.json");
  });

  it("is learner-scoped: distinct source keys yield distinct artifact keys", () => {
    const a = provenanceArtifactKey({
      key: "1/alice@example.com/7/report.pdf",
    });
    const b = provenanceArtifactKey({
      key: "1/bob@example.com/7/report.pdf",
    });
    expect(a).not.toBe(b);
  });

  it("embeds the full source key verbatim and ends in .json", () => {
    const sourceKey = "42/learner@example.com/3/essay.docx";
    const key = provenanceArtifactKey({ key: sourceKey });
    expect(key).toBe(`provenance/${sourceKey}.json`);
    expect(key.endsWith(".json")).toBe(true);
  });

  it("produces different keys for different filenames under the same learner", () => {
    const a = provenanceArtifactKey({ key: "1/learner@example.com/2/a.pdf" });
    const b = provenanceArtifactKey({ key: "1/learner@example.com/2/b.pdf" });
    expect(a).not.toBe(b);
  });

  it("throws on an empty key (defense-in-depth; callers guard first)", () => {
    expect(() => provenanceArtifactKey({ key: "" })).toThrow();
  });
});
