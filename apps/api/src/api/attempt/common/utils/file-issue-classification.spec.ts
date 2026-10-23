import { FileContentExtractionService } from "../../services/file-content-extraction";
import { SourceProcessingError } from "../../../llm/features/grading/errors/source-processing.error";
import {
  classifyFileProblem,
  isEncryptedDocument,
  sniffFileType,
} from "./file-issue-classification";
import { assertRequiredSourceEvidence } from "./required-source-evidence";

const HTML_PAGE = Buffer.from(
  "<!DOCTYPE html>\n<html><head><title>Sheet</title></head><body><table><tr><td>1</td></tr></table></body></html>",
);
const BROKEN_ZIP = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff,
]);
const ENCRYPTED_PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF",
);
const ENCRYPTED_OFFICE = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(64),
  Buffer.from("EncryptedPackage", "utf16le"),
]);

describe("sniffFileType", () => {
  it.each([
    [HTML_PAGE, "html"],
    [BROKEN_ZIP, "zip"],
    [ENCRYPTED_PDF, "pdf"],
    [ENCRYPTED_OFFICE, "ole"],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "png"],
    [Buffer.from('{"cells": []}'), "json"],
    [Buffer.from("plain notes"), undefined],
  ])("identifies %#", (buffer, expected) => {
    expect(sniffFileType(buffer)).toBe(expected);
  });

  it("recognises password-protected PDF and Office containers", () => {
    expect(isEncryptedDocument(ENCRYPTED_PDF)).toBe(true);
    expect(isEncryptedDocument(ENCRYPTED_OFFICE)).toBe(true);
    expect(isEncryptedDocument(Buffer.from("%PDF-1.4 plain"))).toBe(false);
  });
});

describe("classifyFileProblem", () => {
  it("names the real format when the bytes don't match the extension", () => {
    expect(
      classifyFileProblem({
        fileName: "Budget.xlsx",
        failure: "extraction",
        size: HTML_PAGE.length,
        sniffedType: "html",
      }),
    ).toEqual({
      code: "file_wrong_format",
      detectedType: "html",
      expectedType: "xlsx",
    });
  });

  it.each([
    [{ encrypted: true }, "file_encrypted"],
    [{ errorMessage: "No password given" }, "file_encrypted"],
    [{ size: 0 }, "file_empty"],
    [{ sniffedType: "zip" }, "file_corrupt"],
  ] as const)("classifies %j as %s", (facts, code) => {
    expect(
      classifyFileProblem({
        fileName: "report.docx",
        failure: "extraction",
        size: 10,
        ...facts,
      }).code,
    ).toBe(code);
  });

  it("calls a PDF with no text layer a scan, and other empty documents empty", () => {
    expect(
      classifyFileProblem({
        fileName: "scan.pdf",
        failure: "no_content",
        size: 2000,
        sniffedType: "pdf",
      }).code,
    ).toBe("file_no_text");
    expect(
      classifyFileProblem({
        fileName: "notes.docx",
        failure: "no_content",
        size: 2000,
        sniffedType: "zip",
      }).code,
    ).toBe("file_empty");
  });
});

describe("file issues from real extraction", () => {
  const extractor = new FileContentExtractionService({} as never, {} as never);

  async function blockedIssue(filename: string, buffer: Buffer) {
    const files = await extractor.extractContentFromFiles([
      { filename, fileType: "application/octet-stream", buffer } as never,
    ]);
    try {
      assertRequiredSourceEvidence(files, 1);
    } catch (error) {
      expect(error).toBeInstanceOf(SourceProcessingError);
      return (error as SourceProcessingError).toIssue(55);
    }
    throw new Error("expected the file to be blocked");
  }

  it("reports a web page saved as .xlsx as the wrong format", async () => {
    // What a browser saves when the "download" link was really a sign-in page.
    const signInPage = Buffer.from(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in</title><script>location.href="/login"</script></head><body></body></html>',
    );
    const issue = await blockedIssue("Lab 3 Budget.xlsx", signInPage);
    expect(issue).toMatchObject({
      code: "file_wrong_format",
      source: {
        kind: "file",
        fileName: "Lab 3 Budget.xlsx",
        detectedType: "html",
        expectedType: "xlsx",
      },
    });
    expect(issue.message).toContain('"Lab 3 Budget.xlsx"');
    expect(issue.message).toMatch(/web page/);
  });

  it("reports a broken workbook as damaged", async () => {
    const issue = await blockedIssue("broken.xlsx", BROKEN_ZIP);
    expect(issue.code).toBe("file_corrupt");
  });

  it("reports an unparseable notebook as damaged", async () => {
    const issue = await blockedIssue(
      "final.ipynb",
      Buffer.from('{"cells": [ {"cell_type": "code", "source": ['),
    );
    expect(issue.code).toBe("file_corrupt");
  });

  it("reports a web page saved as .ipynb as the wrong format", async () => {
    const issue = await blockedIssue("final.ipynb", HTML_PAGE);
    expect(issue).toMatchObject({
      code: "file_wrong_format",
      source: { detectedType: "html", expectedType: "ipynb" },
    });
  });

  it("reports a password-protected Office file as encrypted", async () => {
    const issue = await blockedIssue("report.docx", ENCRYPTED_OFFICE);
    expect(issue.code).toBe("file_encrypted");
  });
});
