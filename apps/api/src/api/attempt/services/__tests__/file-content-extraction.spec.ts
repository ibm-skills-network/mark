/* eslint-disable  */
import { Logger } from "@nestjs/common";
import { S3Service } from "src/api/files/services/s3.service";
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
