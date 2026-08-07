import { S3Service } from "src/api/files/services/s3.service";
import { UnextractableSubmissionError } from "../../llm/features/grading/errors/unextractable-submission.error";
import { FileContentExtractionService } from "./file-content-extraction";
import { PdfStructureExtractorService } from "./pdf-structure-extractor.service";

/**
 * The fallback strategies will return *something* for any bytes at all — a few
 * ASCII fragments scraped out of a compressed archive, or a hex dump. Passed to
 * a grader, that reads as a learner who submitted nothing of substance, and
 * every criterion is scored zero. These tests pin the boundary where extraction
 * refuses to produce gradable-looking output it cannot stand behind.
 */
describe("FileContentExtractionService — unextractable uploads are rejected", () => {
  interface ExtractInternals {
    extractTextFromBuffer(
      buffer: Buffer,
      filename: string,
      mimeType: string,
    ): Promise<{ text: string; encoding?: string }>;
  }

  function internals(): ExtractInternals {
    const service = new FileContentExtractionService(
      {} as S3Service,
      {} as PdfStructureExtractorService,
    );
    return service as unknown as ExtractInternals;
  }

  it("rejects Apple iWork files with export guidance instead of scraping them", async () => {
    // The observed production case: a Numbers file named to look like a
    // spreadsheet. It is a ZIP archive, so extraction "succeeds" with fragments.
    const buffer = Buffer.from("PKbinary numbers archive body");

    const error = await internals()
      .extractTextFromBuffer(
        buffer,
        "Fleet_Inventory_PART_1_END.XLSX..numbers",
        "application/octet-stream",
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnextractableSubmissionError);
    const typed = error as UnextractableSubmissionError;
    expect(typed.reason).toBe("unsupported_format");
    expect(typed.learnerMessage).toContain("Excel");
    // The learner must be able to tell which upload to replace.
    expect(typed.learnerMessage).toContain(
      "Fleet_Inventory_PART_1_END.XLSX..numbers",
    );
  });

  it("rejects an unrecognized file whose extraction yields only fragments", async () => {
    // Five printable characters surrounded by binary — the exact shape that
    // reached the grader in production as `"content":"InCos"`.
    const buffer = Buffer.from([
      0x00, 0x01, 0x02, 0x49, 0x6e, 0x43, 0x6f, 0x73, 0x00, 0x03, 0x04, 0xff,
      0xfe, 0x00, 0x11,
    ]);

    const error = await internals()
      .extractTextFromBuffer(
        buffer,
        "submission.bin",
        "application/octet-stream",
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnextractableSubmissionError);
    expect((error as UnextractableSubmissionError).reason).toMatch(
      /binary_content|insufficient_text/,
    );
  });

  it("names the file in the message when there is no format-specific advice", async () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe]);

    const error = await internals()
      .extractTextFromBuffer(
        buffer,
        "coursework.bin",
        "application/octet-stream",
      )
      .catch((e: unknown) => e);

    expect((error as UnextractableSubmissionError).learnerMessage).toContain(
      "coursework.bin",
    );
  });

  it("still extracts a readable text file", async () => {
    const text =
      "This is the learner's actual submitted answer, long enough to grade.";
    const result = await internals().extractTextFromBuffer(
      Buffer.from(text, "utf8"),
      "answer.txt",
      "text/plain",
    );

    expect(result.text).toContain("actual submitted answer");
  });
});
