/* eslint-disable */
/**
 * Workbook chart and pivot-table metadata that reaches the grader.
 *
 * A spreadsheet rubric routinely asks for "a column chart", "a legend", "the
 * chart on Sheet3" or "a pivot table with X in rows". All of those facts live
 * in the OOXML package, but the extracted summary used to report only a flat
 * "Chart N: <type> - <title>" list, so correct workbooks were failed for
 * requirements they actually met.
 *
 * Fixture: xlsx-charts-legends-pivot.xlsx
 *   SalesData     raw table
 *   ColumnChart   c:barChart with c:barDir val="col", legend at the bottom
 *   BarChart      c:barChart with c:barDir val="bar", legend on the right
 *   LineChart     c:lineChart with NO legend
 *   PivotSummary  pivot table: row field Region (descending), column field
 *                 Quarter, data field "Sum of Revenue", source SalesData
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "@nestjs/common";
import { S3Service } from "src/api/files/services/s3.service";
import { FileContentExtractionService } from "../file-content-extraction";
import { PdfStructureExtractorService } from "../pdf-structure-extractor.service";

const FIXTURE = path.join(
  __dirname,
  "fixtures",
  "xlsx-charts-legends-pivot.xlsx",
);

function createService(): FileContentExtractionService {
  const service = new FileContentExtractionService(
    {} as S3Service,
    {} as PdfStructureExtractorService,
  );
  (service as any).logger = {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  return service;
}

describe("workbook chart metadata", () => {
  let service: FileContentExtractionService;
  let section: string;
  let counts: { chartCount: number; imageCount: number; pivotCount: number };

  beforeAll(async () => {
    service = createService();
    const buffer = fs.readFileSync(FIXTURE);
    const result = await (service as any).extractExcelChartsAndImages(buffer);
    section = result.section;
    counts = result;
  });

  it("reports a bar chart with barDir=col as a column chart", () => {
    expect(section).toContain('Column Chart - "Units by Region"');
  });

  it("still reports a bar chart with barDir=bar as a bar chart", () => {
    expect(section).toContain('Bar Chart - "Revenue by Region"');
    expect(section).not.toContain('Column Chart - "Revenue by Region"');
  });

  it("attributes each chart to the worksheet that hosts it", () => {
    expect(section).toMatch(/Chart 1 on sheet "ColumnChart"/);
    expect(section).toMatch(/Chart 2 on sheet "BarChart"/);
    expect(section).toMatch(/Chart 3 on sheet "LineChart"/);
  });

  it("reports legend presence and position for each chart", () => {
    expect(section).toContain("Legend: present (bottom)");
    expect(section).toContain("Legend: present (right)");
    expect(section).toContain("Legend: not present");
  });

  it("reports the chart title alongside the type", () => {
    expect(section).toContain('Line Chart - "Revenue Trend by Quarter"');
  });

  it("reports the series ranges each chart is plotted from", () => {
    expect(section).toContain("SalesData!$C$2:$C$9");
    expect(section).toContain("SalesData!$D$2:$D$9");
  });

  it("counts the charts it described", () => {
    expect(counts.chartCount).toBe(3);
  });
});

describe("workbook pivot-table metadata", () => {
  let section: string;
  let pivotCount: number;

  beforeAll(async () => {
    const service = createService();
    const buffer = fs.readFileSync(FIXTURE);
    const result = await (service as any).extractExcelChartsAndImages(buffer);
    section = result.section;
    pivotCount = result.pivotCount;
  });

  it("emits a pivot-table section", () => {
    expect(section).toContain("=== PIVOT TABLES (1 total) ===");
    expect(pivotCount).toBe(1);
  });

  it("names the pivot table and the worksheet it sits on", () => {
    expect(section).toMatch(
      /Pivot table "RevenueByRegion" on sheet "PivotSummary"/,
    );
  });

  it("names the source worksheet", () => {
    expect(section).toContain("source: SalesData");
  });

  it("lists row, column and data fields by their cache-field names", () => {
    expect(section).toContain("Row fields: Region");
    expect(section).toContain("Column fields: Quarter");
    expect(section).toContain("Data fields: Sum of Revenue");
  });

  it("reports the row-field sort order", () => {
    expect(section).toMatch(/Row fields: Region \(sorted descending\)/);
  });
});

describe("workbook chart metadata in the extracted text handed to the grader", () => {
  it("carries chart type, sheet, legend and pivot layout into the summary text", async () => {
    const service = createService();
    const buffer = fs.readFileSync(FIXTURE);

    const result = await (service as any).extractExcelText(buffer, true);

    expect(result.text).toContain('Column Chart - "Units by Region"');
    expect(result.text).toContain('on sheet "ColumnChart"');
    expect(result.text).toContain("Legend: present (bottom)");
    expect(result.text).toContain("=== PIVOT TABLES (1 total) ===");
    expect(result.text).toContain("Data fields: Sum of Revenue");
    expect(result.additionalMetadata.chartCount).toBe(3);
    expect(result.additionalMetadata.pivotCount).toBe(1);
  });

  it("includes legendCount and pivotCount in the workbook summary log", async () => {
    const service = createService();
    const buffer = fs.readFileSync(FIXTURE);

    await (service as any).extractExcelText(buffer, true);

    const logger = (service as any).logger as { log: jest.Mock };
    const summary = logger.log.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.startsWith("xlsx.extract.complete"));

    expect(summary).toBeDefined();
    const payload = JSON.parse(summary!.replace("xlsx.extract.complete ", ""));
    expect(payload.chartCount).toBe(3);
    expect(payload.legendCount).toBe(2);
    expect(payload.pivotCount).toBe(1);
  });
});

describe("chart-type detection from chart XML", () => {
  let service: FileContentExtractionService;

  beforeEach(() => {
    service = createService();
  });

  it("distinguishes a column chart from a bar chart by barDir", () => {
    const column = `<c:barChart><c:barDir val="col"/></c:barChart>`;
    const bar = `<c:barChart><c:barDir val="bar"/></c:barChart>`;
    expect((service as any).detectChartTypeFromXml(column)).toBe(
      "Column Chart",
    );
    expect((service as any).detectChartTypeFromXml(bar)).toBe("Bar Chart");
  });

  it("applies barDir to 3D bar charts too", () => {
    const xml = `<c:bar3DChart><c:barDir val="col"/></c:bar3DChart>`;
    expect((service as any).detectChartTypeFromXml(xml)).toBe(
      "3D Column Chart",
    );
  });

  it("falls back to Bar Chart when barDir is absent", () => {
    expect((service as any).detectChartTypeFromXml(`<c:barChart>`)).toBe(
      "Bar Chart",
    );
  });
});

describe("workbook chart extraction guard rails", () => {
  it("ignores a workbook whose chart parts exceed the parse budget", async () => {
    const service = createService();
    const JSZip = require("jszip");
    const zip = new JSZip();
    // A package with far more chart parts than any real submission.
    for (let index = 1; index <= 120; index++) {
      zip.file(
        `xl/charts/chart${index}.xml`,
        `<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
      );
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const result = await (service as any).extractExcelChartsAndImages(buffer);

    expect(result.chartCount).toBeLessThanOrEqual(50);
    const logger = (service as any).logger as { warn: jest.Mock };
    expect(logger.warn).toHaveBeenCalled();
  });
});
