/* eslint-disable  */
import { Logger } from "@nestjs/common";
import { S3Service } from "src/api/files/services/s3.service";
import { OversizedSubmissionError } from "../../../llm/features/grading/errors/oversized-submission.error";
import { FileContentExtractionService } from "../file-content-extraction";
import { PdfStructureExtractorService } from "../pdf-structure-extractor.service";

const mockS3Service = {} as S3Service;
const mockPdfExtractor = {} as PdfStructureExtractorService;

function createService(): FileContentExtractionService {
  const service = new FileContentExtractionService(
    mockS3Service,
    mockPdfExtractor,
  );
  // suppress logger output in tests
  (service as any).logger = {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  return service;
}

// ─── Chart-type detection ──────────────────────────────────────────────────

describe("FileContentExtractionService.detectChartTypeFromXml", () => {
  let service: FileContentExtractionService;

  beforeEach(() => {
    service = createService();
  });

  it("detects Bar Chart", () => {
    const xml = `<c:chartSpace><c:chart><c:plotArea><c:barChart></c:barChart></c:plotArea></c:chart></c:chartSpace>`;
    expect((service as any).detectChartTypeFromXml(xml)).toBe("Bar Chart");
  });

  it("detects Line Chart", () => {
    const xml = `<c:lineChart>`;
    expect((service as any).detectChartTypeFromXml(xml)).toBe("Line Chart");
  });

  it("detects Pie Chart", () => {
    const xml = `<c:pieChart>`;
    expect((service as any).detectChartTypeFromXml(xml)).toBe("Pie Chart");
  });

  it("detects Scatter Chart", () => {
    const xml = `<c:scatterChart>`;
    expect((service as any).detectChartTypeFromXml(xml)).toBe("Scatter Chart");
  });

  it("detects Radar/Spider Chart", () => {
    const xml = `<c:radarChart>`;
    expect((service as any).detectChartTypeFromXml(xml)).toBe(
      "Radar/Spider Chart",
    );
  });

  it("detects Doughnut Chart", () => {
    const xml = `<c:doughnutChart>`;
    expect((service as any).detectChartTypeFromXml(xml)).toBe("Doughnut Chart");
  });

  it("detects 3D Bar Chart", () => {
    const xml = `<c:bar3DChart>`;
    expect((service as any).detectChartTypeFromXml(xml)).toBe("3D Bar Chart");
  });

  it("returns generic 'Chart' when no known type found", () => {
    const xml = `<c:chartSpace><c:chart></c:chart></c:chartSpace>`;
    expect((service as any).detectChartTypeFromXml(xml)).toBe("Chart");
  });
});

// ─── Chart-title extraction ────────────────────────────────────────────────

describe("FileContentExtractionService.extractChartTitleFromXml", () => {
  let service: FileContentExtractionService;

  beforeEach(() => {
    service = createService();
  });

  it("extracts title from rich text <a:t> node", () => {
    const xml = `
      <c:chartSpace>
        <c:chart>
          <c:title>
            <c:tx><c:rich>
              <a:p><a:r><a:t>Sales 2024</a:t></a:r></a:p>
            </c:rich></c:tx>
          </c:title>
        </c:chart>
      </c:chartSpace>`;
    expect((service as any).extractChartTitleFromXml(xml)).toBe("Sales 2024");
  });

  it("concatenates multiple <a:t> nodes in the title", () => {
    const xml = `
      <c:title>
        <c:tx><c:rich>
          <a:p>
            <a:r><a:t>Part A</a:t></a:r>
            <a:r><a:t>Part B</a:t></a:r>
          </a:p>
        </c:rich></c:tx>
      </c:title>`;
    const result = (service as any).extractChartTitleFromXml(xml) as string;
    expect(result).toContain("Part A");
    expect(result).toContain("Part B");
  });

  it("falls back to formula reference when no rich text", () => {
    const xml = `
      <c:title>
        <c:tx><c:strRef>
          <c:f>Sheet1!$A$1</c:f>
        </c:strRef></c:tx>
      </c:title>`;
    expect((service as any).extractChartTitleFromXml(xml)).toBe("Sheet1!$A$1");
  });

  it("returns empty string when no title element present", () => {
    const xml = `<c:chartSpace><c:chart></c:chart></c:chartSpace>`;
    expect((service as any).extractChartTitleFromXml(xml)).toBe("");
  });
});

// ─── extractSourceCode ─────────────────────────────────────────────────────

describe("FileContentExtractionService.extractSourceCode", () => {
  let service: FileContentExtractionService;

  beforeEach(() => {
    service = createService();
  });

  const codeFiles: Array<{ ext: string; sample: string; lang: string }> = [
    {
      ext: "py",
      sample: `import os\n\ndef main():\n    print("Hello World")\n\nif __name__ == "__main__":\n    main()\n`,
      lang: "Python",
    },
    {
      ext: "java",
      sample: `public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}\n`,
      lang: "Java",
    },
    {
      ext: "cpp",
      sample: `#include <iostream>\n\nint main() {\n    std::cout << "Hello";\n    return 0;\n}\n`,
      lang: "C++",
    },
    {
      ext: "c",
      sample: `#include <stdio.h>\n\nint main() {\n    printf("Hello");\n    return 0;\n}\n`,
      lang: "C",
    },
    {
      ext: "js",
      sample: `function greet(name) {\n  console.log("Hello " + name);\n}\ngreet("World");\n`,
      lang: "JavaScript",
    },
    {
      ext: "ts",
      sample: `interface User { name: string; }\nfunction greet(user: User): string {\n  return "Hello " + user.name;\n}\n`,
      lang: "TypeScript",
    },
  ];

  for (const { ext, sample, lang } of codeFiles) {
    it(`extracts ${lang} source code with metadata header`, async () => {
      const buffer = Buffer.from(sample, "utf8");
      const result = await (service as any).extractSourceCode(buffer, ext);

      expect(result.text).toContain(`=== SOURCE CODE (${lang})`);
      expect(result.text).toContain("--- CODE ---");
      expect(result.text).toContain(sample.split("\n")[0]); // first line present
      expect(result.extractedText).toBe(sample); // raw code unchanged
    });
  }

  it("includes import/dependency summary when imports are present", async () => {
    const code = `import numpy as np\nimport pandas as pd\n\ndef compute():\n    pass\n`;
    const buffer = Buffer.from(code, "utf8");
    const result = await (service as any).extractSourceCode(buffer, "py");

    expect(result.text).toContain("Imports/Dependencies:");
    expect(result.text).toContain("import numpy as np");
  });
});

// ─── .class and .jar handling ──────────────────────────────────────────────

describe("FileContentExtractionService - binary file handling", () => {
  let service: FileContentExtractionService;

  beforeEach(() => {
    service = createService();
  });

  it(".class files return a binary notice, not garbled bytecode", async () => {
    // Java bytecode magic bytes: 0xCA 0xFE 0xBA 0xBE
    const classBytecode = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00]);
    const result = await (service as any).extractByExtension(
      classBytecode,
      "Hello.class",
      "class",
    );

    expect(result).not.toBeNull();
    expect(result.text).toContain("Java Bytecode");
    expect(result.text).toContain("binary bytecode");
    // Raw bytecode characters should NOT appear in extracted text
    expect(result.extractedText).toBe("");
  });
});

describe("FileContentExtractionService - existing .ipynb content handling", () => {
  let service: FileContentExtractionService;

  beforeEach(() => {
    service = createService();
  });

  it("parses existing ipynb JSON content to include code cells and outputs", async () => {
    const notebook = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        language_info: { name: "python" },
      },
      cells: [
        {
          cell_type: "code",
          source: ['print("hello")\n'],
          execution_count: 1,
          outputs: [
            {
              output_type: "stream",
              name: "stdout",
              text: ["hello\n"],
            },
          ],
          metadata: {},
        },
        {
          cell_type: "markdown",
          source: ["## Notes\n", "Some explanation."],
          metadata: {},
        },
      ],
    };

    const result = await (service as any).extractSingleFileContent({
      filename: "analysis.ipynb",
      content: JSON.stringify(notebook),
      fileType: "application/x-ipynb+json",
    });

    expect(result.content).toContain(
      "=== JUPYTER NOTEBOOK: analysis.ipynb ===",
    );
    expect(result.content).toContain("=== CELL 1 [CODE] [1] ===");
    expect(result.content).toContain('print("hello")');
    expect(result.content).toContain("--- OUTPUT ---");
    expect(result.content).toContain("[stdout]:");
    expect(result.content).toContain("hello");
    expect(result.content).toContain("=== CELL 2 [MARKDOWN] ===");
    expect(result.metadata.cellCount).toBe(2);
    expect(result.metadata.outputCount).toBe(1);
  });

  it("keeps existing non-JSON ipynb content unchanged", async () => {
    const existingText = "Notebook summary prepared on client side";

    const result = await (service as any).extractSingleFileContent({
      filename: "summary.ipynb",
      content: existingText,
      fileType: "application/x-ipynb+json",
    });

    expect(result.content).toBe(existingText);
    expect(result.extractedText).toBeUndefined();
  });
});

// ─── extractExcelText – chart/image sections ──────────────────────────────

describe("FileContentExtractionService.extractExcelText - chart and image detection", () => {
  let service: FileContentExtractionService;

  beforeEach(() => {
    service = createService();
  });

  it("extracts cell data from a basic Excel workbook", async () => {
    // Dynamically build a minimal XLSX buffer using the XLSX library
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Score"],
      ["Alice", 90],
      ["Bob", 85],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    );

    const result = await (service as any).extractExcelText(buffer, true);

    expect(result.text).toContain("=== EXCEL WORKBOOK ===");
    expect(result.text).toContain("=== SHEET: Results ===");
    expect(result.text).toContain("Alice");
    expect(result.text).toContain("90");
    expect(result.additionalMetadata.sheetCount).toBe(1);
    // No charts or images in this simple workbook
    expect(result.additionalMetadata.chartCount).toBe(0);
    expect(result.additionalMetadata.imageCount).toBe(0);
  });

  it("reports chartCount = 0 and imageCount = 0 for a plain workbook", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["A", "B"],
      [1, 2],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    );

    const result = await (service as any).extractExcelText(buffer, true);

    expect(result.additionalMetadata.chartCount).toBe(0);
    expect(result.additionalMetadata.imageCount).toBe(0);
  });

  it("does NOT attempt ZIP-based chart extraction for .xls files", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["X", "Y"],
      [1, 2],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    // Write as XLS (OLE2) – unzipper cannot parse this
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xls" }),
    );

    // isXlsx = false → should not call extractExcelChartsAndImages
    const spy = jest
      .spyOn(service as any, "extractExcelChartsAndImages")
      .mockResolvedValue({ section: "", chartCount: 0, imageCount: 0 });

    await (service as any).extractExcelText(buffer, false);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("mocks an XLSX with a chart and reports chartCount = 1", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["A"], [1]]);
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    );

    // Mock extractExcelChartsAndImages to simulate a chart being found
    jest
      .spyOn(service as any, "extractExcelChartsAndImages")
      .mockResolvedValue({
        section:
          '\n=== CHARTS (1 total) ===\n- Chart 1: Bar Chart - "Revenue"\n',
        chartCount: 1,
        imageCount: 0,
      });

    const result = await (service as any).extractExcelText(buffer, true);

    expect(result.additionalMetadata.chartCount).toBe(1);
    expect(result.additionalMetadata.imageCount).toBe(0);
    expect(result.text).toContain("=== CHARTS (1 total) ===");
    expect(result.text).toContain("Bar Chart");
    expect(result.text).toContain("Revenue");
  });
});

// ─── extractExcelText – formal-dimension clamp ────────────────────────────

describe("FileContentExtractionService.extractExcelText - used-range clamping", () => {
  let service: FileContentExtractionService;

  beforeEach(() => {
    service = createService();
  });

  // Jest test timeout: with the bug present, sheet_to_csv on a wide !ref
  // hangs the worker (the original production failure mode). A tight per-test
  // timeout converts that into a deterministic failure inside Jest.
  it("clamps a worksheet with formal full-sheet !ref to only its real used cells", async () => {
    // Strategy: build a normal narrow-range workbook (cheap, just 3 rows),
    // then intercept XLSX.read inside the service so it returns that
    // workbook with !ref forcibly widened to the full-sheet formal range.
    // This mirrors what a production XLSX with a formal `dimension`
    // attribute looks like after parse, without paying the cost of writing
    // a 17-billion-cell sheet to disk.
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item", "Qty", "Price"],
      ["Widget", 3, 4.5],
      ["Gadget", 1, 12.25],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");

    const readSpy = jest
      .spyOn(service as any, "readExcelWorkbook")
      .mockImplementation(() => {
        // Mutate the parsed workbook to carry the wide !ref the production
        // file had baked in.
        wb.Sheets["Inventory"]["!ref"] = "A1:XFD1048576";
        return wb;
      });
    // Avoid the ZIP traversal — not relevant to the clamping behavior.
    jest
      .spyOn(service as any, "extractExcelChartsAndImages")
      .mockResolvedValue({ section: "", chartCount: 0, imageCount: 0 });

    try {
      const result = await (service as any).extractExcelText(
        Buffer.from([]),
        true,
      );

      // Real values must survive the clamp.
      expect(result.text).toContain("Widget");
      expect(result.text).toContain("Gadget");
      expect(result.text).toContain("4.5");

      // The pre-fix output for this fixture explodes into >1,000,000 lines
      // because sheet_to_csv honors the wide !ref. After the clamp the
      // output must be bounded.
      const lineCount = result.text.split("\n").length;
      expect(lineCount).toBeLessThan(50);

      // The Range banner must reflect the clamped range, not the formal one.
      expect(result.text).not.toContain("A1:XFD1048576");
    } finally {
      readSpy.mockRestore();
    }
  }, 15_000);

  it("preserves CSV body for a worksheet with a legitimate used range", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Score"],
      ["Alice", 90],
      ["Bob", 85],
      ["Carol", 77],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    );

    const result = await (service as any).extractExcelText(buffer, true);

    expect(result.text).toContain("Alice");
    expect(result.text).toContain("Bob");
    expect(result.text).toContain("Carol");
    expect(result.text).toContain("90");
    expect(result.text).toContain("85");
    expect(result.text).toContain("77");
    // No phantom blank rows past the real used range.
    const blankTabRowMatches = result.text.match(/\n\t+\n/g) ?? [];
    expect(blankTabRowMatches.length).toBeLessThan(5);
  });

  it("emits one structured info log per workbook with sheetCount and totalUsedCells", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["A", "B"],
      [1, 2],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    );

    const loggerInfo = jest.fn();
    (service as any).logger = {
      debug: jest.fn(),
      log: loggerInfo,
      info: loggerInfo,
      warn: jest.fn(),
      error: jest.fn(),
    };

    await (service as any).extractExcelText(buffer, true);

    // Exactly one summary call. The NestJS Logger treats a second object
    // argument as a context label, so the structured fields are folded into
    // the message string — assert they actually land in the log line.
    const summaryCalls = loggerInfo.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("xlsx.extract.complete"),
    );
    expect(summaryCalls).toHaveLength(1);

    const message = summaryCalls[0][0] as string;
    const payloadJson = message.slice("xlsx.extract.complete ".length);
    const payload = JSON.parse(payloadJson) as {
      sheetCount: number;
      totalUsedCells: number;
      chartCount: number;
      imageCount: number;
    };
    expect(payload).toEqual(
      expect.objectContaining({
        sheetCount: 1,
        totalUsedCells: expect.any(Number),
        chartCount: expect.any(Number),
        imageCount: expect.any(Number),
      }),
    );
    expect(payload.totalUsedCells).toBeGreaterThan(0);
  });
});

describe("FileContentExtractionService.shouldUseStructuredExtraction", () => {
  let service: FileContentExtractionService;
  const original = process.env.ENABLE_PDF_STRUCTURED_EXTRACTION;

  beforeEach(() => {
    service = createService();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ENABLE_PDF_STRUCTURED_EXTRACTION;
    } else {
      process.env.ENABLE_PDF_STRUCTURED_EXTRACTION = original;
    }
  });

  it("enables structured extraction for a PDF by default (flag unset)", () => {
    delete process.env.ENABLE_PDF_STRUCTURED_EXTRACTION;
    expect((service as any).shouldUseStructuredExtraction(true, false)).toBe(
      true,
    );
  });

  it("disables it globally when ENABLE_PDF_STRUCTURED_EXTRACTION=false (kill switch)", () => {
    process.env.ENABLE_PDF_STRUCTURED_EXTRACTION = "false";
    expect((service as any).shouldUseStructuredExtraction(true, false)).toBe(
      false,
    );
  });

  it("respects a per-call opt-out even when the flag is enabled", () => {
    delete process.env.ENABLE_PDF_STRUCTURED_EXTRACTION;
    expect((service as any).shouldUseStructuredExtraction(true, true)).toBe(
      false,
    );
  });

  it("never uses structured extraction for non-PDF files", () => {
    delete process.env.ENABLE_PDF_STRUCTURED_EXTRACTION;
    expect((service as any).shouldUseStructuredExtraction(false, false)).toBe(
      false,
    );
  });
});

describe("FileContentExtractionService - oversized submissions fail extraction", () => {
  let service: FileContentExtractionService;
  const original = process.env.ENABLE_PDF_STRUCTURED_EXTRACTION;

  beforeEach(() => {
    // Force the structured-extraction branch on deterministically.
    delete process.env.ENABLE_PDF_STRUCTURED_EXTRACTION;
    service = createService();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ENABLE_PDF_STRUCTURED_EXTRACTION;
    } else {
      process.env.ENABLE_PDF_STRUCTURED_EXTRACTION = original;
    }
  });

  const pdfFile = {
    filename: "huge.pdf",
    fileType: "application/pdf",
    bucket: "bucket",
    key: "key",
    content: "InCos",
  };

  it("restamps the surfaced error with the upload filename, not the internal submission id", async () => {
    jest
      .spyOn(service as any, "downloadFileFromCOS")
      .mockResolvedValue(Buffer.from("pdf"));
    // The extractor only knows the prefixed internal submission id. The
    // catch must restamp the surfaced error with the learner's real filename.
    const oversized = new OversizedSubmissionError({
      blockCount: 60_000,
      cap: 50_000,
      filename: "123_huge.pdf",
    });
    (service as any).pdfStructureExtractor = {
      extractStructuredContent: jest.fn().mockRejectedValue(oversized),
    };

    const promise = (service as any).extractContentFromFiles([pdfFile], {
      useStructuredExtraction: true,
    });

    await expect(promise).rejects.toMatchObject({
      name: "OversizedSubmissionError",
      filename: "huge.pdf",
      blockCount: 60_000,
      cap: 50_000,
    });

    // Restamping creates a copy, so it is no longer the same instance, but it
    // must remain an OversizedSubmissionError so downstream type checks hold.
    let caught: unknown;
    try {
      await (service as any).extractContentFromFiles([pdfFile], {
        useStructuredExtraction: true,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OversizedSubmissionError);
    expect(caught).not.toBe(oversized);
  });

  it("still falls back to simple extraction for generic structured-extraction failures", async () => {
    jest
      .spyOn(service as any, "downloadFileFromCOS")
      .mockResolvedValue(Buffer.from("plain text content"));
    (service as any).pdfStructureExtractor = {
      extractStructuredContent: jest
        .fn()
        .mockRejectedValue(new Error("parser exploded")),
    };

    const results = await (service as any).extractContentFromFiles([pdfFile], {
      useStructuredExtraction: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].filename).toBe("huge.pdf");
    // The fallback must produce a real simple-extraction result, not an
    // outer-catch "[ERROR extracting...]" blob (which would carry `error`).
    expect(results[0].error).toBeUndefined();
  });
});

// ─── Content provenance shadow mode ───────────────────────────────────────

import * as crypto from "node:crypto";
import { provenanceArtifactKey } from "../../common/utils/provenance-artifact.util";

function sha16(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .substring(0, 16);
}

function buildProvenanceService(): {
  service: FileContentExtractionService;
  putObject: jest.Mock;
  logs: { warn: jest.Mock; debug: jest.Mock; log: jest.Mock; error: jest.Mock };
} {
  const service = createService();
  const putObject = jest.fn().mockResolvedValue({});
  (service as any).s3Service = { putObject };
  const warn = jest.fn();
  const debug = jest.fn();
  const log = jest.fn();
  const error = jest.fn();
  (service as any).logger = { warn, debug, log, error };
  return { service, putObject, logs: { warn, debug, log, error } };
}

function provenanceWarn(warn: jest.Mock, prefix: string): any {
  const call = warn.mock.calls.find(
    (c) => typeof c[0] === "string" && c[0].startsWith(prefix),
  );
  if (!call) return undefined;
  return JSON.parse((call[0] as string).slice(prefix.length).trim());
}

function lastPutBody(putObject: jest.Mock): any {
  const call = putObject.mock.calls[putObject.mock.calls.length - 1];
  return JSON.parse(call[0].Body);
}

describe("FileContentExtractionService - content provenance shadow mode", () => {
  const original = process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;
    } else {
      process.env.ENABLE_CONTENT_PROVENANCE_SHADOW = original;
    }
  });

  describe("trust-branch telemetry", () => {
    it("logs provenance.trust.client.content with correct length/sha16/hasCosCoordinates and leaves the result unchanged", async () => {
      delete process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;
      const clientContent = "the client supplied this exact text";
      const file = {
        filename: "answer.txt",
        content: clientContent,
        fileType: "text/plain",
        questionId: 11,
        recordId: 99,
      };

      // Flag-off control run for deep-equal comparison.
      process.env.ENABLE_CONTENT_PROVENANCE_SHADOW = "false";
      const control = createService();
      const controlResult = await (control as any).extractSingleFileContent({
        ...file,
      });

      delete process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;
      const { service, putObject, logs } = buildProvenanceService();
      const result = await (service as any).extractSingleFileContent({
        ...file,
      });

      // Zero behavior change: identical extraction result.
      expect(result).toEqual(controlResult);

      const payload = provenanceWarn(logs.warn, "provenance.trust.client.content");
      expect(payload).toMatchObject({
        questionId: 11,
        recordId: 99,
        filename: "answer.txt",
        fileType: "text/plain",
        contentLength: clientContent.length,
        contentSha16: sha16(clientContent),
        hasCosCoordinates: false,
        hasGithubUrl: false,
      });

      // No bucket → telemetry only, nothing persisted.
      expect(putObject).not.toHaveBeenCalled();
    });

    it("hashes the same string grading receives (sanitized/truncated content)", async () => {
      delete process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;
      const clientContent = "plain answer text";
      const { service, logs } = buildProvenanceService();
      const result = await (service as any).extractSingleFileContent({
        filename: "answer.txt",
        content: clientContent,
        fileType: "text/plain",
        questionId: 1,
        recordId: 2,
      });
      const payload = provenanceWarn(
        logs.warn,
        "provenance.trust.client.content",
      );
      // The hashed string must equal the returned `content` exactly.
      expect(payload.contentSha16).toBe(sha16(result.content));
      expect(payload.contentLength).toBe(result.content.length);
    });
  });

  describe("divergence comparison (trusted file also has COS coordinates)", () => {
    const buildFile = () => ({
      filename: "data.txt",
      content: "client text",
      fileType: "text/plain",
      questionId: 5,
      recordId: 17,
      bucket: "learner-bucket",
      key: "uploads/data.txt",
    });

    it("reports diverged:false and persists a server artifact when re-extraction matches", async () => {
      delete process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;
      const file = buildFile();
      const { service, putObject, logs } = buildProvenanceService();

      jest
        .spyOn(service as any, "downloadFileFromCOS")
        .mockResolvedValue(Buffer.from("client text"));
      jest
        .spyOn(service as any, "extractTextFromBuffer")
        .mockResolvedValue({ text: "client text" });

      await (service as any).extractSingleFileContent(file);

      const divergence = provenanceWarn(logs.warn, "provenance.divergence");
      expect(divergence).toMatchObject({
        questionId: 5,
        recordId: 17,
        filename: "data.txt",
        diverged: false,
        clientSha16: sha16("client text"),
        serverSha16: sha16("client text"),
        clientLength: "client text".length,
        serverLength: "client text".length,
      });

      expect(putObject).toHaveBeenCalledTimes(1);
      const putCall = putObject.mock.calls[0][0];
      expect(putCall.Key).toBe(provenanceArtifactKey(file));
      expect(putCall.Bucket).toBe("learner-bucket");
      const body = JSON.parse(putCall.Body);
      expect(body).toMatchObject({
        provenance: "server",
        clientSha16: sha16("client text"),
        // The artifact's own canonical checksum is the server-extracted text.
        sha16: sha16("client text"),
        diverged: false,
      });
    });

    it("reports diverged:true when server re-extraction differs, persisting both checksums", async () => {
      delete process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;
      const file = buildFile();
      const { service, putObject, logs } = buildProvenanceService();

      jest
        .spyOn(service as any, "downloadFileFromCOS")
        .mockResolvedValue(Buffer.from("server bytes"));
      jest
        .spyOn(service as any, "extractTextFromBuffer")
        .mockResolvedValue({ text: "server extracted text DIFFERENT" });

      await (service as any).extractSingleFileContent(file);

      const divergence = provenanceWarn(logs.warn, "provenance.divergence");
      expect(divergence.diverged).toBe(true);
      expect(divergence.clientSha16).toBe(sha16("client text"));
      expect(divergence.serverSha16).toBe(
        sha16("server extracted text DIFFERENT"),
      );

      const body = JSON.parse(putObject.mock.calls[0][0].Body);
      expect(body.diverged).toBe(true);
      expect(body.clientSha16).toBe(sha16("client text"));
      // The artifact's own canonical checksum is the server-extracted text.
      expect(body.sha16).toBe(sha16("server extracted text DIFFERENT"));
    });
  });

  describe("download-branch server artifact", () => {
    it("persists a server-provenance artifact once with content and metrics; result unchanged vs flag-off control", async () => {
      const file = {
        filename: "report.pdf",
        content: "InCos",
        fileType: "application/pdf",
        questionId: 3,
        recordId: 8,
        bucket: "learner-bucket",
        key: "uploads/report.pdf",
      };

      // Flag-off control.
      process.env.ENABLE_CONTENT_PROVENANCE_SHADOW = "false";
      const control = createService();
      jest
        .spyOn(control as any, "downloadFileFromCOS")
        .mockResolvedValue(Buffer.from("pdf bytes"));
      jest.spyOn(control as any, "extractTextFromBuffer").mockResolvedValue({
        text: "extracted report body",
        additionalMetadata: { pageCount: 2 },
      });
      const controlResult = await (control as any).extractSingleFileContent({
        ...file,
      });

      delete process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;
      const { service, putObject } = buildProvenanceService();
      jest
        .spyOn(service as any, "downloadFileFromCOS")
        .mockResolvedValue(Buffer.from("pdf bytes"));
      jest.spyOn(service as any, "extractTextFromBuffer").mockResolvedValue({
        text: "extracted report body",
        additionalMetadata: { pageCount: 2 },
      });
      const result = await (service as any).extractSingleFileContent({
        ...file,
      });

      expect(result).toEqual(controlResult);

      expect(putObject).toHaveBeenCalledTimes(1);
      const putCall = putObject.mock.calls[0][0];
      expect(putCall.Key).toBe(provenanceArtifactKey(file));
      expect(putCall.ContentType).toBe("application/json");
      const body = JSON.parse(putCall.Body);
      expect(body).toMatchObject({
        schemaVersion: 1,
        provenance: "server",
        recordId: 8,
        questionId: 3,
        filename: "report.pdf",
        fileType: "application/pdf",
        sha16: sha16("extracted report body"),
        contentLength: "extracted report body".length,
        content: "extracted report body",
      });
      expect(body.metrics).toMatchObject({ pageCount: 2 });
      expect(typeof body.extractedAt).toBe("string");
    });
  });

  describe("kill switch", () => {
    it("does nothing when ENABLE_CONTENT_PROVENANCE_SHADOW=false: zero putObject, zero provenance logs", async () => {
      process.env.ENABLE_CONTENT_PROVENANCE_SHADOW = "false";
      const { service, putObject, logs } = buildProvenanceService();

      jest
        .spyOn(service as any, "downloadFileFromCOS")
        .mockResolvedValue(Buffer.from("pdf bytes"));
      jest
        .spyOn(service as any, "extractTextFromBuffer")
        .mockResolvedValue({ text: "extracted report body" });

      // Trust-branch file with coords.
      await (service as any).extractSingleFileContent({
        filename: "data.txt",
        content: "client text",
        fileType: "text/plain",
        questionId: 5,
        recordId: 17,
        bucket: "learner-bucket",
        key: "uploads/data.txt",
      });
      // Download-branch file.
      await (service as any).extractSingleFileContent({
        filename: "report.pdf",
        content: "InCos",
        fileType: "application/pdf",
        questionId: 3,
        recordId: 8,
        bucket: "learner-bucket",
        key: "uploads/report.pdf",
      });

      expect(putObject).not.toHaveBeenCalled();
      const provenanceLogs = logs.warn.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].startsWith("provenance."),
      );
      expect(provenanceLogs).toHaveLength(0);
    });
  });

  describe("tolerance", () => {
    it("logs provenance.shadow.failed and resolves extraction normally when putObject rejects", async () => {
      delete process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;
      const { service, putObject, logs } = buildProvenanceService();
      putObject.mockRejectedValue(new Error("S3 down"));

      jest
        .spyOn(service as any, "downloadFileFromCOS")
        .mockResolvedValue(Buffer.from("pdf bytes"));
      jest
        .spyOn(service as any, "extractTextFromBuffer")
        .mockResolvedValue({ text: "extracted body" });

      const result = await (service as any).extractSingleFileContent({
        filename: "report.pdf",
        content: "InCos",
        fileType: "application/pdf",
        questionId: 3,
        recordId: 8,
        bucket: "learner-bucket",
        key: "uploads/report.pdf",
      });

      // Extraction succeeds despite the persistence failure.
      expect(result.content).toContain("extracted body");
      const failed = provenanceWarn(logs.warn, "provenance.shadow.failed");
      expect(failed).toMatchObject({ filename: "report.pdf" });
    });
  });

  describe("oversized artifact", () => {
    it("omits content and sets contentOmitted when content exceeds the cap", async () => {
      delete process.env.ENABLE_CONTENT_PROVENANCE_SHADOW;
      const big = "x".repeat(600_001);
      const { service, putObject } = buildProvenanceService();

      jest
        .spyOn(service as any, "downloadFileFromCOS")
        .mockResolvedValue(Buffer.from("pdf bytes"));
      jest
        .spyOn(service as any, "extractTextFromBuffer")
        .mockResolvedValue({ text: big });

      await (service as any).extractSingleFileContent({
        filename: "report.pdf",
        content: "InCos",
        fileType: "application/pdf",
        questionId: 3,
        recordId: 8,
        bucket: "learner-bucket",
        key: "uploads/report.pdf",
      });

      const body = lastPutBody(putObject);
      expect(body.content).toBeNull();
      expect(body.contentOmitted).toBe(true);
    });
  });
});
