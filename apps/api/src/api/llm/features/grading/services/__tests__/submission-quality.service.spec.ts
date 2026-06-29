import { SubmissionQualityService } from "../submission-quality.service";
import { ExtractedChunk } from "../../types/criterion-evidence.types";

function makeChunk(
  text: string,
  page = 1,
  id?: string,
): ExtractedChunk {
  const chunkId = id ?? text.slice(0, 8).replaceAll(/\s/g, "_");
  return {
    chunkId,
    text,
    sourceType: "file",
    sourceId: "test-submission",
    anchor: { type: "file", page, blockId: chunkId },
    hash: chunkId,
  };
}

describe("SubmissionQualityService", () => {
  let service: SubmissionQualityService;

  beforeEach(() => {
    service = new SubmissionQualityService();
  });

  describe("empty input", () => {
    it("classifies empty chunk list as empty", () => {
      const { quality } = service.classifyChunks([]);
      expect(quality.classification).toBe("empty");
      expect(quality.rawChunkCount).toBe(0);
      expect(quality.eligibleChunkCount).toBe(0);
    });
  });

  describe("page label detection", () => {
    it.each([
      "1",
      "Page 1",
      "page 1 of 100",
      "Page 1 of 2000",
      "1/100",
      "- 1 -",
      "10",
      "100",
    ])('classifies "%s" as page_label ineligible', (text) => {
      const { chunks } = service.classifyChunks([makeChunk(text)]);
      expect(chunks[0].quality?.eligibility).toBe("ineligible");
      expect(chunks[0].quality?.ineligibleReasons).toContain("page_label");
    });

    it("does NOT classify a substantive sentence as page_label", () => {
      // Needs ≥6 unique substantive tokens to clear the too_short guard.
      const text = "The model achieved 95% accuracy on the validation test dataset.";
      const { chunks } = service.classifyChunks([makeChunk(text)]);
      expect(chunks[0].quality?.eligibility).toBe("eligible");
    });
  });

  describe("metadata banner detection", () => {
    it.each([
      "=== PDF DOCUMENT ===",
      "--- CONTENT ---",
      "=== GENERATED SUMMARY ===",
      "Pages: 12",
      "Title: My Report",
      "Creator: Adobe PDF",
    ])('classifies "%s" as metadata_only ineligible', (text) => {
      const { chunks } = service.classifyChunks([makeChunk(text)]);
      expect(chunks[0].quality?.eligibility).toBe("ineligible");
      expect(chunks[0].quality?.ineligibleReasons).toContain("metadata_only");
    });
  });

  describe("too_short detection", () => {
    it("classifies very short chunks as too_short", () => {
      const { chunks } = service.classifyChunks([makeChunk("ok")]);
      expect(chunks[0].quality?.eligibility).toBe("ineligible");
      expect(chunks[0].quality?.ineligibleReasons).toContain("too_short");
    });

    it("does NOT classify a short but substantive chunk as too_short", () => {
      // Needs ≥6 unique substantive tokens to clear the too_short guard.
      const text = "Data normalization removes redundancy by organizing relational database tables.";
      const { chunks } = service.classifyChunks([makeChunk(text)]);
      expect(chunks[0].quality?.eligibility).toBe("eligible");
    });
  });

  describe("boilerplate repeat detection", () => {
    it("classifies text repeated on 5+ pages as boilerplate", () => {
      const repeatedText = "Confidential — Internal Use Only";
      const chunks = Array.from({ length: 6 }, (_, i) =>
        makeChunk(repeatedText, i + 1, `c${i}`),
      );
      const { chunks: classified } = service.classifyChunks(chunks);
      for (const chunk of classified) {
        expect(chunk.quality?.eligibility).toBe("ineligible");
        expect(chunk.quality?.ineligibleReasons).toContain("boilerplate");
      }
    });

    it("does NOT classify text repeated on 4 pages as boilerplate", () => {
      // Needs ≥6 unique substantive tokens so too_short doesn't fire before the boilerplate check.
      const text = "Introduction to Machine Learning algorithms, neural networks, and deep learning concepts.";
      const chunks = Array.from({ length: 4 }, (_, i) =>
        makeChunk(text, i + 1, `c${i}`),
      );
      const { chunks: classified } = service.classifyChunks(chunks);
      for (const chunk of classified) {
        expect(chunk.quality?.eligibility).toBe("eligible");
      }
    });
  });

  describe("prompt_copy detection", () => {
    it("classifies near-exact question restatement as prompt_copy", () => {
      const question =
        "Explain the concept of data normalization and its importance in database design.";
      const submissionText =
        "Explain the concept of data normalization and its importance in database design.";
      const { chunks } = service.classifyChunks([makeChunk(submissionText)], {
        question,
      });
      expect(chunks[0].quality?.eligibility).toBe("ineligible");
      expect(chunks[0].quality?.ineligibleReasons).toContain("prompt_copy");
    });

    it("does NOT classify a real answer as prompt_copy", () => {
      const question = "Explain data normalization.";
      const submissionText =
        "Data normalization is the process of organizing a relational database to reduce redundancy " +
        "and improve data integrity. It involves dividing large tables into smaller ones and defining " +
        "relationships between them.";
      const { chunks } = service.classifyChunks([makeChunk(submissionText)], {
        question,
      });
      expect(chunks[0].quality?.eligibility).toBe("eligible");
    });
  });

  describe("boilerplate_many_pages classification", () => {
    it("classifies poison-many-pages style submission as boilerplate_many_pages", () => {
      const chunks: ExtractedChunk[] = [];
      for (let page = 1; page <= 30; page++) {
        chunks.push(makeChunk(`page ${page} of 2000`, page, `p${page}`));
        chunks.push(makeChunk(`${page}`, page, `n${page}`));
      }

      const { quality } = service.classifyChunks(chunks);
      expect(quality.eligibleChunkCount).toBe(0);
      expect(quality.classification).toBe("boilerplate_many_pages");
    });
  });

  describe("clean submission", () => {
    it("passes through substantive learner content as eligible", () => {
      const chunks = [
        makeChunk(
          "Data normalization is the process of organizing a database to reduce redundancy.",
          1,
        ),
        makeChunk(
          "First Normal Form requires that each column contains atomic values.",
          1,
        ),
        makeChunk(
          "Second Normal Form eliminates partial dependencies on the primary key.",
          2,
        ),
      ];

      const { chunks: classified, quality } = service.classifyChunks(chunks);
      expect(quality.eligibleChunkCount).toBe(3);
      expect(quality.classification).toBe("clean");
      for (const chunk of classified) {
        expect(chunk.quality?.eligibility).toBe("eligible");
      }
    });
  });

  describe("substantiveTokenCount", () => {
    it("records substantiveTokenCount for each chunk", () => {
      const text = "Data normalization reduces redundancy in relational databases.";
      const { chunks } = service.classifyChunks([makeChunk(text)]);
      expect(chunks[0].quality?.substantiveTokenCount).toBeGreaterThan(0);
    });
  });
});
