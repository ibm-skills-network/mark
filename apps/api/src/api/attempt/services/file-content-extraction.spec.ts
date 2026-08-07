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

  it("keeps astral characters that arrive as correctly paired surrogates", async () => {
    // Emoji and CJK extension characters live above the BMP and are encoded
    // as surrogate *pairs* in JavaScript strings. The guard exists to catch
    // lone halves; a paired one is ordinary text and must pass, or the check
    // would start rejecting real submissions that merely contain an emoji.
    const astral = "The answer 🎓 also cites 𠀀 from the reading list.";
    const result = await internals().extractTextFromBuffer(
      Buffer.from(astral, "utf8"),
      "coursework.dat",
      "application/octet-stream",
    );

    expect(result.text).toContain("🎓");
    expect(result.text).toContain("𠀀");
  });

  it("accepts fallback text exactly at the minimum length", async () => {
    const twentyChars = "a".repeat(20);
    const result = await internals().extractTextFromBuffer(
      Buffer.from(twentyChars, "utf8"),
      "coursework.dat",
      "application/octet-stream",
    );

    expect(result.text.trim()).toHaveLength(20);
  });

  it("rejects fallback text one character below the minimum", async () => {
    const nineteenChars = "a".repeat(19);
    const error = await internals()
      .extractTextFromBuffer(
        Buffer.from(nineteenChars, "utf8"),
        "coursework.dat",
        "application/octet-stream",
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnextractableSubmissionError);
    expect((error as UnextractableSubmissionError).reason).toBe(
      "insufficient_text",
    );
  });

  it("does not reject a .key file that is not an iWork container", async () => {
    // The unsupported-extension list names iWork suffixes, but "key" also
    // means PEM key files in CS coursework, and a dotless filename makes its
    // whole name the extension token. iWork documents are ZIP containers, so
    // only the ZIP signature makes the extension token trustworthy.
    const pem =
      "-----BEGIN PUBLIC KEY-----\n" +
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7bq0\n" +
      "-----END PUBLIC KEY-----\n";
    const result = await internals().extractTextFromBuffer(
      Buffer.from(pem, "utf8"),
      "server.key",
      "application/octet-stream",
    );

    expect(result.text).toContain("BEGIN PUBLIC KEY");
  });
});

/**
 * A file the service cannot even fetch is a different failure class from one
 * it cannot read: the learner did nothing wrong and the bytes may be fine.
 * Turning that into placeholder "content" hands the grader a note about a
 * missing file to score — the job must fail and retry instead.
 */
describe("FileContentExtractionService — infrastructure failures fail the job", () => {
  it("propagates a storage failure instead of returning gradable placeholder text", async () => {
    const failingS3 = {
      getObject: jest.fn().mockRejectedValue(new Error("connection reset")),
    } as unknown as S3Service;
    const service = new FileContentExtractionService(
      failingS3,
      {} as PdfStructureExtractorService,
    );

    await expect(
      service.extractContentFromFiles([
        {
          filename: "essay.txt",
          content: "",
          fileType: "text/plain",
          bucket: "submissions",
          key: "attempt-1/essay.txt",
        },
      ]),
    ).rejects.toThrow("Could not retrieve file");
  });
});
