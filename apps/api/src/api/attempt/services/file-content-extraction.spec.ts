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

  /**
   * The production failure that neither the length nor the encoding check
   * catches. UTF-16LE decoding does not produce the replacement characters
   * that disqualify the other encodings, so an 800KB archive decoded into
   * ~400k characters of plausible-looking CJK and was graded as the learner's
   * work. Unpaired surrogates are the part that cannot survive UTF-8 encoding,
   * which is what made the model provider reject the request outright.
   */
  it("rejects binary that UTF-16LE decoding turned into plausible text", async () => {
    // Repeating U+D800 (bytes 00 D8 little-endian) then "A": a lone high
    // surrogate. Invalid as UTF-8, so extraction falls through to UTF-16LE.
    const pattern = Buffer.from([0x00, 0xd8, 0x41, 0x00]);
    const buffer = Buffer.concat(Array.from({ length: 1000 }, () => pattern));

    const error = await internals()
      .extractTextFromBuffer(
        buffer,
        "coursework.dat",
        "application/octet-stream",
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnextractableSubmissionError);
    const typed = error as UnextractableSubmissionError;
    expect(typed.reason).toBe("binary_content");
    // Length alone would have passed this: it is far above the floor.
    expect(typed.extractedLength).toBeGreaterThan(100);
  });

  it("does not mistake genuine non-Latin text for decoded binary", async () => {
    // Well-formed CJK has no unpaired surrogates and must survive the guard,
    // otherwise the check would reject real submissions in these languages.
    const japanese =
      "これは学習者が提出した実際の解答です。採点できる長さがあります。";
    const result = await internals().extractTextFromBuffer(
      Buffer.from(japanese, "utf8"),
      "coursework.dat",
      "application/octet-stream",
    );

    expect(result.text).toContain("学習者");
  });
});
