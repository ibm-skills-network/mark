import { CanonicalSubmission } from "src/api/attempt/services/structured-content.models";
import { EvidenceChunkingService } from "./evidence-chunking.service";

function makeSubmission(
  blocks: Array<{ text: string; pinnedEvidence?: boolean }>,
): CanonicalSubmission {
  return {
    submissionId: "solution.py",
    metadata: {
      wordCount: 10,
      pageCount: 1,
      blockCount: blocks.length,
      sourceType: "txt",
      checksum: "abc123",
      extractedAt: new Date().toISOString(),
    },
    pages: [
      {
        pageNumber: 1,
        blocks: blocks.map((block, index) => ({
          blockId: `p1b${index + 1}`,
          type: "code" as const,
          text: block.text,
          page: 1,
          ...(block.pinnedEvidence ? { pinnedEvidence: true } : {}),
        })),
      },
    ],
  } as CanonicalSubmission;
}

describe("EvidenceChunkingService pinned-block propagation", () => {
  const service = new EvidenceChunkingService();

  it("carries ContentBlock.pinnedEvidence into chunk.metadata.pinned", () => {
    const submission = makeSubmission([
      {
        text: "=== FILE: solution.py (complete) ===\ndef f():\n    return 1",
        pinnedEvidence: true,
      },
      { text: "def f():\n    return 1" },
    ]);

    const chunks = service.extractFromSubmission(submission);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata?.pinned).toBe(true);
    expect(chunks[1].metadata?.pinned).toBeUndefined();
  });

  it("does not mark any chunk pinned when no block is pinned", () => {
    const submission = makeSubmission([
      { text: "def f():\n    return 1" },
      { text: "def g():\n    return 2" },
    ]);

    const chunks = service.extractFromSubmission(submission);

    expect(chunks.every((chunk) => chunk.metadata?.pinned === undefined)).toBe(
      true,
    );
  });
});
