import {
  CanonicalSubmission,
  ContentBlock,
} from "src/api/attempt/services/structured-content.models";
import { EvidenceChunkingService } from "./evidence-chunking.service";
import {
  DOC_WHOLE_SUBMISSION_BLOCK_MAX_CHARS,
  PROSE_SECTION_MAX_CHARS,
} from "./source-code.utils";

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

function makeDocumentSubmission(
  pages: Array<Array<Partial<ContentBlock> & { text: string }>>,
): CanonicalSubmission {
  return {
    submissionId: "report.pdf",
    metadata: {
      wordCount: 100,
      pageCount: pages.length,
      blockCount: pages.reduce((sum, blocks) => sum + blocks.length, 0),
      sourceType: "pdf",
      checksum: "doc123",
      extractedAt: new Date().toISOString(),
    },
    pages: pages.map((blocks, pageIndex) => ({
      pageNumber: pageIndex + 1,
      blocks: blocks.map((block, blockIndex) => ({
        blockId: `p${pageIndex + 1}b${blockIndex + 1}`,
        type: "paragraph" as const,
        page: pageIndex + 1,
        ...block,
      })),
    })),
  } as CanonicalSubmission;
}

describe("EvidenceChunkingService prose section merging", () => {
  const service = new EvidenceChunkingService();

  it("merges consecutive prose blocks on a page into one section chunk", () => {
    const submission = makeDocumentSubmission([
      [
        { text: "Executive Summary" },
        { text: "This project develops an end-to-end workflow." },
        { text: "Key results follow." },
      ],
    ]);

    const chunks = service.extractFromSubmission(submission);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(
      "Executive Summary\nThis project develops an end-to-end workflow.\nKey results follow.",
    );
    expect(chunks[0].metadata?.section).toBe(true);
    expect(chunks[0].anchor).toEqual(
      expect.objectContaining({ type: "file", page: 1, blockId: "p1b1" }),
    );
  });

  it("does not merge blocks across pages", () => {
    const submission = makeDocumentSubmission([
      [{ text: "Slide one heading" }, { text: "Slide one body" }],
      [{ text: "Slide two heading" }, { text: "Slide two body" }],
    ]);

    const chunks = service.extractFromSubmission(submission);
    const sections = chunks.filter((chunk) => chunk.metadata?.section);

    expect(sections).toHaveLength(2);
    expect(sections[0].text).toBe("Slide one heading\nSlide one body");
    expect(sections[1].text).toBe("Slide two heading\nSlide two body");
  });

  it("does not merge blocks across sourceFilename boundaries", () => {
    const submission = makeDocumentSubmission([
      [
        { text: "readme line one", sourceFilename: "README.md" },
        { text: "readme line two", sourceFilename: "README.md" },
        { text: "notes line one", sourceFilename: "notes.txt" },
      ],
    ]);

    const chunks = service.extractFromSubmission(submission);
    const sections = chunks.filter((chunk) => chunk.metadata?.section);

    expect(sections).toHaveLength(2);
    expect(sections[0].text).toBe("readme line one\nreadme line two");
    expect(sections[0].metadata?.filename).toBe("README.md");
    expect(sections[1].text).toBe("notes line one");
    expect(sections[1].metadata?.filename).toBe("notes.txt");
  });

  it("caps a section at PROSE_SECTION_MAX_CHARS and starts a new one", () => {
    const big = "x".repeat(PROSE_SECTION_MAX_CHARS - 100);
    const submission = makeDocumentSubmission([
      [{ text: big }, { text: "y".repeat(200) }],
    ]);

    const chunks = service.extractFromSubmission(submission);
    const sections = chunks.filter((chunk) => chunk.metadata?.section);

    expect(sections).toHaveLength(2);
    expect(sections[0].text).toBe(big);
    expect(sections[1].text).toBe("y".repeat(200));
  });

  it("keeps image and code blocks standalone between sections", () => {
    const submission = makeDocumentSubmission([
      [
        { text: "prose before" },
        { text: "chart ocr text", type: "image" },
        { text: "prose after" },
        { text: "print('hi')", type: "code" },
      ],
    ]);

    const chunks = service.extractFromSubmission(submission);

    const sections = chunks.filter((chunk) => chunk.metadata?.section);
    expect(sections.map((s) => s.text)).toEqual([
      "prose before",
      "prose after",
    ]);
    expect(
      chunks.some(
        (chunk) =>
          chunk.anchor.type === "image" && chunk.text === "chart ocr text",
      ),
    ).toBe(true);
    expect(chunks.some((chunk) => chunk.text === "print('hi')")).toBe(true);
  });

  it("adds a pinned whole-document chunk for multi-section documents", () => {
    const submission = makeDocumentSubmission([
      [{ text: "Slide one heading" }, { text: "Slide one body" }],
      [{ text: "Slide two heading" }, { text: "Slide two body" }],
    ]);

    const chunks = service.extractFromSubmission(submission);
    const pinned = chunks.filter((chunk) => chunk.metadata?.pinned);

    expect(pinned).toHaveLength(1);
    expect(pinned[0].text).toContain("=== DOCUMENT: report.pdf (complete) ===");
    expect(pinned[0].text).toContain("=== PAGE 1 ===");
    expect(pinned[0].text).toContain("=== PAGE 2 ===");
    expect(pinned[0].text).toContain("Slide two body");
  });

  it("bounds the whole-document chunk and marks truncation", () => {
    const pageText = "z".repeat(3500);
    const submission = makeDocumentSubmission(
      Array.from({ length: 6 }, () => [{ text: pageText }]),
    );

    const chunks = service.extractFromSubmission(submission);
    const pinned = chunks.find((chunk) => chunk.metadata?.pinned);

    expect(pinned).toBeDefined();
    expect(pinned!.text.length).toBeLessThanOrEqual(
      DOC_WHOLE_SUBMISSION_BLOCK_MAX_CHARS,
    );
    expect(pinned!.text).toContain("(truncated)");
    expect(pinned!.text).toContain("... [document truncated]");
  });

  it("does not add a whole-document chunk when a pinned block already exists", () => {
    const submission = makeDocumentSubmission([
      [
        {
          text: "=== FILE: solution.py (complete) ===\ncode",
          type: "code",
          pinnedEvidence: true,
        },
        { text: "prose one" },
      ],
      [{ text: "prose two" }],
    ]);

    const chunks = service.extractFromSubmission(submission);
    const pinned = chunks.filter((chunk) => chunk.metadata?.pinned);

    expect(pinned).toHaveLength(1);
    expect(pinned[0].text).toContain("=== FILE: solution.py");
  });

  it("does not add a whole-document chunk when one section holds the whole document", () => {
    const submission = makeDocumentSubmission([
      [{ text: "only paragraph" }, { text: "still same section" }],
    ]);

    const chunks = service.extractFromSubmission(submission);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata?.pinned).toBeUndefined();
  });

  it("splits a single oversized block into capped section chunks anchored at that block", () => {
    const words = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");
    const submission = makeDocumentSubmission([[{ text: words }]]);

    const chunks = service.extractFromSubmission(submission);
    const sections = chunks.filter((chunk) => chunk.metadata?.section);

    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(section.text.length).toBeLessThanOrEqual(PROSE_SECTION_MAX_CHARS);
      expect(section.anchor).toEqual(
        expect.objectContaining({ type: "file", blockId: "p1b1" }),
      );
      // Every piece must be findable inside the anchored block's text.
      expect(words.includes(section.text)).toBe(true);
    }
  });

  it("records the anchored block's text length on section chunks", () => {
    const submission = makeDocumentSubmission([
      [{ text: "short heading" }, { text: "a much longer body line follows" }],
    ]);

    const chunks = service.extractFromSubmission(submission);

    expect(chunks[0].metadata?.anchorTextChars).toBe("short heading".length);
  });

  it("anchors the whole-document chunk at the first prose block", () => {
    const submission = makeDocumentSubmission([
      [{ text: "chart ocr", type: "image" }, { text: "first prose" }],
      [{ text: "second page prose" }],
    ]);

    const chunks = service.extractFromSubmission(submission);
    const pinned = chunks.find((chunk) => chunk.metadata?.pinned);

    expect(pinned?.anchor).toEqual(
      expect.objectContaining({ type: "file", page: 1, blockId: "p1b2" }),
    );
    expect(pinned?.metadata?.wholeDocument).toBe(true);
    expect(pinned?.metadata?.anchorTextChars).toBe("first prose".length);
  });

  it("labels the whole-document chunk honestly when non-prose blocks are omitted", () => {
    const withImages = makeDocumentSubmission([
      [{ text: "chart ocr", type: "image" }, { text: "first prose" }],
      [{ text: "second page prose" }],
    ]);
    const allProse = makeDocumentSubmission([
      [{ text: "first prose" }],
      [{ text: "second page prose" }],
    ]);

    const pinnedWithImages = service
      .extractFromSubmission(withImages)
      .find((chunk) => chunk.metadata?.pinned);
    const pinnedAllProse = service
      .extractFromSubmission(allProse)
      .find((chunk) => chunk.metadata?.pinned);

    expect(pinnedWithImages?.text).toContain("(text content)");
    expect(pinnedWithImages?.text).not.toContain("(complete)");
    expect(pinnedAllProse?.text).toContain("(complete)");
  });
});
