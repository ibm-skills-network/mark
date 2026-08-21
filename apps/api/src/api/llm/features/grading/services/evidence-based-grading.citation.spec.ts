import { EvidenceBasedGradingService } from "./evidence-based-grading.service";
import { ExtractedChunk } from "../types/criterion-evidence.types";
import { EvidenceCitation } from "src/api/attempt/services/structured-content.models";

// chunkToEvidenceCitation is pure — instantiate without DI to test it.
function callCitation(
  chunk: ExtractedChunk | undefined,
  fallbackId = "fallback",
): EvidenceCitation {
  const service = Object.create(
    EvidenceBasedGradingService.prototype,
  ) as EvidenceBasedGradingService;
  return (
    service as unknown as {
      chunkToEvidenceCitation: (
        chunk: ExtractedChunk | undefined,
        fallbackId: string,
      ) => EvidenceCitation;
    }
  ).chunkToEvidenceCitation(chunk, fallbackId);
}

function makeChunk(
  text: string,
  metadata?: ExtractedChunk["metadata"],
): ExtractedChunk {
  return {
    chunkId: "abcdef0123456789",
    hash: "abcdef0123456789",
    text,
    sourceType: "file",
    sourceId: "report.pdf",
    anchor: { type: "file", page: 3, blockId: "p3b1" },
    metadata,
  };
}

describe("chunkToEvidenceCitation", () => {
  it("keeps the plain-chunk quote behavior", () => {
    const chunk = makeChunk("x".repeat(500));
    const citation = callCitation(chunk);
    expect(citation.quote).toBe("x".repeat(200));
    expect(citation.blockId).toBe("p3b1");
  });

  it("bounds a section chunk's quote to the anchored block's text", () => {
    const chunk = makeChunk("short line\nnext merged block text follows", {
      section: true,
      anchorTextChars: "short line".length,
    });
    const citation = callCitation(chunk);
    expect(citation.quote).toBe("short line");
  });

  it("strips whole-document marker lines from the learner-facing quote", () => {
    const chunk = makeChunk(
      "=== DOCUMENT: report.pdf (complete) ===\n=== PAGE 1 ===\nExecutive Summary\nmore text",
      {
        pinned: true,
        wholeDocument: true,
        anchorTextChars: "Executive Summary".length,
      },
    );
    const citation = callCitation(chunk);
    expect(citation.quote).toBe("Executive Summary");
    expect(citation.blockId).toBe("p3b1");
  });
});
