/* eslint-disable */
/**
 * Workbook chart, pivot-table and image descriptions must reach evidence
 * retrieval as coherent units.
 *
 * Spreadsheet text becomes one evidence block per line, and evidence chunking
 * packs consecutive blocks into bounded sections. A chart description spans
 * several lines (heading with type and title, then legend, then series
 * ranges), so a section boundary could fall inside it: the heading ended one
 * chunk and its legend started the next. The validator then picked the chunk
 * holding the legend and the other charts, and a learner whose first chart
 * was correct got no credit because that chunk never named its type or title.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "@nestjs/common";
import { LearnerFileUpload } from "src/api/attempt/common/interfaces/attempt.interface";
import { S3Service } from "src/api/files/services/s3.service";
import { FileContentExtractionService } from "src/api/attempt/services/file-content-extraction";
import { PdfStructureExtractorService } from "src/api/attempt/services/pdf-structure-extractor.service";
import { CanonicalSubmission } from "src/api/attempt/services/structured-content.models";
import { EvidenceChunkingService } from "../evidence-chunking.service";

const FIXTURE = path.join(
  __dirname,
  "../../../../../attempt/services/__tests__/fixtures/xlsx-charts-legends-pivot.xlsx",
);

function quietLogger() {
  return {
    debug: jest.fn(),
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
}

function buildGradingService() {
  const service = Object.create(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../file-grading.service").FileGradingService.prototype,
  );
  service.logger = quietLogger();
  return service;
}

async function extractWorkbookText(): Promise<string> {
  const extractor = new FileContentExtractionService(
    {} as S3Service,
    {} as PdfStructureExtractorService,
  );
  (extractor as any).logger = quietLogger() as unknown as Logger;
  const result = await (extractor as any).extractExcelText(
    fs.readFileSync(FIXTURE),
    true,
  );
  return result.extractedText as string;
}

/**
 * Insert filler data rows under the first sheet's header: enough to push the
 * object sections past one evidence section, plus one row of `extra` chars
 * that moves the section boundary through them a few characters at a time.
 */
function padFirstSheet(text: string, extra: number): string {
  const marker = /=== SHEET: [^\n]+ ===\n/;
  const rows = Array.from(
    { length: 20 },
    (_, index) => `${index + 1}\t${"x".repeat(97)}`,
  );
  rows.push(`0\t${"y".repeat(extra)}`);
  return text.replace(marker, (header) => `${header}${rows.join("\n")}\n`);
}

function toSubmission(text: string): CanonicalSubmission {
  const file = {
    filename: "workbook.xlsx",
    fileType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    key: "k",
    bucket: "b",
    content: text,
    extractedText: text,
  } as LearnerFileUpload;
  return buildGradingService().buildCanonicalSubmissionFromText(text, file);
}

/** Each "- ..." entry of an object section, continuation lines included. */
function objectEntries(text: string, title: string): string[][] {
  const start = text.indexOf(`=== ${title} (`);
  if (start < 0) return [];
  const lines = text.slice(start).split("\n").slice(1);
  const entries: string[][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("===")) break;
    if (line.startsWith("- ")) entries.push([line]);
    else entries.at(-1)?.push(line);
  }
  return entries;
}

function sectionChunksContaining(
  submission: CanonicalSubmission,
  needle: string,
) {
  return new EvidenceChunkingService()
    .extractFromSubmission(submission)
    .filter((chunk) => !chunk.metadata?.wholeDocument)
    .filter((chunk) => chunk.text.includes(needle));
}

describe("workbook object descriptions in evidence chunks", () => {
  let workbookText: string;

  beforeAll(async () => {
    workbookText = await extractWorkbookText();
  });

  it("fixture describes multi-line charts", () => {
    const charts = objectEntries(workbookText, "CHARTS");
    expect(charts.length).toBeGreaterThanOrEqual(3);
    expect(charts.every((chart) => chart.length >= 2)).toBe(true);
  });

  // Sweep the filler size so a section boundary lands throughout the object
  // sections.
  const paddings = Array.from({ length: 300 }, (_, index) => 1 + index * 5);

  it.each(paddings)(
    "keeps every chart heading in the same chunk as its details (%i filler chars)",
    (rows) => {
      const text = padFirstSheet(workbookText, rows);
      const submission = toSubmission(text);
      for (const chart of objectEntries(workbookText, "CHARTS")) {
        const [heading, ...details] = chart;
        const holders = sectionChunksContaining(submission, heading);
        expect(holders).toHaveLength(1);
        const lines = holders[0].text.split("\n").map((line) => line.trim());
        const at = lines.indexOf(heading);
        expect(lines.slice(at, at + chart.length)).toEqual([
          heading,
          ...details,
        ]);
      }
    },
  );

  it.each(paddings)(
    "keeps each pivot table description whole (%i filler chars)",
    (rows) => {
      const text = padFirstSheet(workbookText, rows);
      const submission = toSubmission(text);
      for (const pivot of objectEntries(workbookText, "PIVOT TABLES")) {
        const [heading, ...details] = pivot;
        const holders = sectionChunksContaining(submission, heading);
        expect(holders).toHaveLength(1);
        const lines = holders[0].text.split("\n").map((line) => line.trim());
        const at = lines.indexOf(heading);
        expect(lines.slice(at, at + pivot.length)).toEqual([
          heading,
          ...details,
        ]);
      }
    },
  );

  it("keeps the CHARTS header with the first chart", () => {
    const blocks = toSubmission(workbookText).pages[0].blocks;
    const header = blocks.find((block) => block.text.includes("=== CHARTS ("));
    const [firstChart] = objectEntries(workbookText, "CHARTS");
    expect(header?.text).toContain(firstChart[0]);
  });

  it("still emits sheet rows as one block per line", () => {
    const text =
      "=== EXCEL WORKBOOK ===\nTotal Sheets: 1\n\n=== SHEET: Data ===\nRegion\tUnits\nNorth\t10\nSouth\t20\n";
    const blocks = toSubmission(text).pages[0].blocks.filter((block) =>
      /North|South|Region/.test(block.text),
    );
    expect(blocks.map((block) => block.text)).toEqual([
      "Region | Units",
      "North | 10",
      "South | 20",
    ]);
  });

  it("does not group dash rows of sheet data that are not object sections", () => {
    const text =
      "=== EXCEL WORKBOOK ===\n=== SHEET: Notes ===\n- first note\n  indented cell\n- second note\n";
    const blocks = toSubmission(text).pages[0].blocks.map(
      (block) => block.text,
    );
    expect(blocks).toEqual(
      expect.arrayContaining([
        "- first note",
        "indented cell",
        "- second note",
      ]),
    );
  });

  it("ends an object section at the next extractor section", () => {
    const text = [
      "=== EXCEL WORKBOOK ===",
      "=== SHEET: Data ===",
      "a\tb",
      "",
      "=== CHARTS (1 total) ===",
      '- Chart 1 on sheet "Data": Bar Chart - "Units"',
      "  Legend: present (right)",
      "",
      "=== DOCUMENT PROPERTIES ===",
      "Author: someone",
      "Title: something",
    ].join("\n");
    const blocks = toSubmission(text).pages[0].blocks.map(
      (block) => block.text,
    );
    expect(blocks).toContain(
      '=== CHARTS (1 total) ===\n- Chart 1 on sheet "Data": Bar Chart - "Units"\n  Legend: present (right)',
    );
    expect(blocks).toContain("=== DOCUMENT PROPERTIES ===");
    expect(blocks).toContain("Author: someone");
    expect(blocks).toContain("Title: something");
  });
});
