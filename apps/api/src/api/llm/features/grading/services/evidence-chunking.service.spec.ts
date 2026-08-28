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

/**
 * A block that produced an image carries a grading-time note about what that
 * image actually shows. It must reach the retrieved text — a grader citing the
 * plotting code alone would otherwise infer output the picture contradicts —
 * while block.text stays the learner's own content.
 */
describe("EvidenceChunkingService renderedOutputNote", () => {
  const service = new EvidenceChunkingService();

  function submissionWith(blocks: unknown[]): CanonicalSubmission {
    return {
      submissionId: "analysis.ipynb",
      metadata: {
        wordCount: 10,
        pageCount: 1,
        blockCount: blocks.length,
        sourceType: "ipynb",
        checksum: "abc123",
        extractedAt: new Date().toISOString(),
      },
      pages: [{ pageNumber: 1, blocks }],
    } as CanonicalSubmission;
  }

  it("folds the note into the producing block's chunk text", () => {
    const chunks = service.extractFromSubmission(
      submissionWith([
        {
          blockId: "p1b1_cell5",
          type: "code",
          page: 1,
          text: "ax = monthly.plot(kind='bar')",
          renderedOutputNote:
            "[Visual check of this cell's image output — the figure is empty]",
        },
      ]),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("kind='bar'");
    expect(chunks[0].text).toContain("the figure is empty");
  });

  it("leaves a block without a note unchanged", () => {
    const chunks = service.extractFromSubmission(
      submissionWith([
        {
          blockId: "p1b1_cell5",
          type: "code",
          page: 1,
          text: "import pandas as pd",
        },
      ]),
    );

    expect(chunks[0].text).toBe("import pandas as pd");
  });
});
