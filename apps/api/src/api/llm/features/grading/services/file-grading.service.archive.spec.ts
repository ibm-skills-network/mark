/* eslint-disable */
import { Logger } from "@nestjs/common";
import { LearnerFileUpload } from "src/api/attempt/common/interfaces/attempt.interface";
import { EvidenceChunkingService } from "./evidence-chunking.service";
import { FileGradingService } from "./file-grading.service";

function createService(): FileGradingService {
  const service = Object.create(
    FileGradingService.prototype,
  ) as FileGradingService;
  (service as any).logger = {
    debug: jest.fn(),
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  return service;
}

const LISTING =
  "=== ARCHIVE: SmartTravelJournal.zip (ZIP) ===\n" +
  "Total files: 3\n\n" +
  "--- FILE LISTING ---\n" +
  "SmartTravelJournal/Trip.swift (5.3 KB)\n" +
  "SmartTravelJournal/README.md (46 Bytes)\n";

function makeZipUpload(): LearnerFileUpload {
  return {
    filename: "SmartTravelJournal.zip",
    content: "",
    questionId: 7,
    fileType: "application/zip",
    extractedText:
      LISTING + "\n--- CONTENT: SmartTravelJournal/Trip.swift ---\n@Model\n",
    archiveListing: LISTING,
    archiveEntries: [
      {
        path: "SmartTravelJournal/Trip.swift",
        text:
          "import SwiftData\n\n@Model\nfinal class Trip {\n" +
          "    var id: UUID\n    var title: String\n" +
          "    @Relationship(deleteRule: .cascade) var entries: [JournalEntry] = []\n}\n",
        truncated: false,
      },
      {
        path: "SmartTravelJournal/README.md",
        text: "# SmartTravelJournal\nCapstone readme.\n",
        truncated: false,
      },
    ],
  };
}

describe("FileGradingService archive canonical submission", () => {
  let service: FileGradingService;

  beforeEach(() => {
    service = createService();
  });

  it("embeds per-entry code blocks in one canonical submission", () => {
    const enriched: LearnerFileUpload[] = (
      service as any
    ).ensureStructuredContentForEvidenceGrading([makeZipUpload()], false);

    expect(enriched).toHaveLength(1);
    const submission = enriched[0].structuredContent!;
    expect(submission).toBeDefined();
    expect(submission.submissionId).toBe("SmartTravelJournal.zip");

    const blocks = submission.pages[0].blocks;
    const pinnedCode = blocks.find(
      (b) =>
        b.type === "code" &&
        b.pinnedEvidence === true &&
        b.text.includes("=== FILE: SmartTravelJournal/Trip.swift"),
    );
    expect(pinnedCode).toBeDefined();
    expect(pinnedCode!.sourceFilename).toBe("SmartTravelJournal/Trip.swift");
    expect(pinnedCode!.text).toContain("@Model");
    expect(pinnedCode!.text).toContain("deleteRule: .cascade");

    // The listing survives as structure evidence.
    expect(blocks.some((b) => b.text.includes("--- FILE LISTING ---"))).toBe(
      true,
    );
  });

  it("keeps archive submissions evidence-eligible off the CODE/REPO route", () => {
    const enriched: LearnerFileUpload[] = (
      service as any
    ).ensureStructuredContentForEvidenceGrading([makeZipUpload()], false);
    expect((service as any).isEvidenceBasedEligible(enriched[0], false)).toBe(
      true,
    );
  });

  it("leaves non-archive uploads on the existing prose path", () => {
    const plain: LearnerFileUpload = {
      filename: "report.md",
      content: "",
      extractedText: "First paragraph.\n\nSecond paragraph.",
    };
    const enriched: LearnerFileUpload[] = (
      service as any
    ).ensureStructuredContentForEvidenceGrading([plain], false);
    const blocks = enriched[0].structuredContent!.pages[0].blocks;
    expect(blocks.some((b) => b.type === "code")).toBe(false);
    expect(blocks.every((b) => b.sourceFilename === undefined)).toBe(true);
  });
});

describe("EvidenceChunkingService per-block filenames", () => {
  it("stamps chunk metadata with the block's source filename when present", () => {
    const chunking = new EvidenceChunkingService();
    const chunks = chunking.extractFromSubmission({
      submissionId: "SmartTravelJournal.zip",
      metadata: {
        wordCount: 4,
        pageCount: 1,
        blockCount: 2,
        sourceType: "txt",
        checksum: "abc",
        extractedAt: new Date().toISOString(),
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [
            {
              blockId: "p1b1",
              type: "paragraph",
              text: "--- FILE LISTING ---",
              page: 1,
            },
            {
              blockId: "p1b2",
              type: "code",
              text: "=== FILE: A/Trip.swift (complete) ===\n@Model",
              page: 1,
              pinnedEvidence: true,
              sourceFilename: "A/Trip.swift",
            },
          ],
        },
      ],
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata?.filename).toBe("SmartTravelJournal.zip");
    expect(chunks[1].metadata?.filename).toBe("A/Trip.swift");
    expect(chunks[1].metadata?.pinned).toBe(true);
  });
});
