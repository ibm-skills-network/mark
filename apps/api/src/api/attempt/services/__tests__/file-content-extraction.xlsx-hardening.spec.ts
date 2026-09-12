/* eslint-disable */
/**
 * Workbook package parsing against hostile input.
 *
 * A learner upload is an arbitrary attacker-supplied zip. Three properties have
 * to hold no matter what the package claims about itself:
 *
 *   1. the byte budget is enforced on the bytes that actually inflate, not on
 *      the size the zip's own central directory declares;
 *   2. scanning a part's XML costs time proportional to its length, even when
 *      every element it contains is left unclosed;
 *   3. the relationship walk visits a bounded number of parts and never
 *      decompresses the same part twice, however a package cross-links itself.
 */
import * as zlib from "node:zlib";
import { Logger } from "@nestjs/common";
import * as unzipper from "unzipper";
import { S3Service } from "src/api/files/services/s3.service";
import { FileContentExtractionService } from "../file-content-extraction";
import { PdfStructureExtractorService } from "../pdf-structure-extractor.service";

/** The service's own part budget, mirrored so the tests can reason about it. */
const PART_BYTE_CAP = 5_000_000;

interface CraftedFile {
  path: string;
  content: string;
  /**
   * What the central directory should claim the part inflates to. Real zip
   * writers put the truth here; nothing in the format makes them.
   */
  declaredUncompressedSize?: number;
}

/**
 * Write a zip by hand so the central directory can disagree with the deflate
 * stream it points at. Every zip library writes honest sizes, which is exactly
 * the assumption under test.
 */
function craftZip(files: CraftedFile[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const raw = Buffer.from(file.content, "utf8");
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const crc = zlib.crc32(raw) >>> 0;
    const declared = file.declaredUncompressedSize ?? raw.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04_03_4b_50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(deflated.length, 18);
    localHeader.writeUInt32LE(declared, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localChunks.push(localHeader, name, deflated);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02_01_4b_50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(deflated.length, 20);
    centralHeader.writeUInt32LE(declared, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralChunks.push(centralHeader, name);

    localOffset += 30 + name.length + deflated.length;
  }

  const locals = Buffer.concat(localChunks);
  const central = Buffer.concat(centralChunks);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06_05_4b_50, 0);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(central.length, 12);
  endRecord.writeUInt32LE(locals.length, 16);

  return Buffer.concat([locals, central, endRecord]);
}

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

function warnPayloads(
  service: FileContentExtractionService,
  prefix: string,
): any[] {
  const logger = (service as any).logger as { warn: jest.Mock };
  return logger.warn.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith(`${prefix} `))
    .map((line) => JSON.parse(line.slice(prefix.length + 1)));
}

/**
 * Count how often each package part is actually decompressed, by wrapping the
 * entries unzipper hands back. Memoisation is only observable here.
 */
function countInflations(): {
  counts: Map<string, number>;
  restore: () => void;
} {
  const counts = new Map<string, number>();
  const original = unzipper.Open.buffer;
  const spy = jest
    .spyOn(unzipper.Open, "buffer")
    .mockImplementation(async (...arguments_: any[]) => {
      const zip: any = await (original as any).apply(unzipper.Open, arguments_);
      for (const entry of zip.files) {
        const record = (): void => {
          counts.set(entry.path, (counts.get(entry.path) ?? 0) + 1);
        };
        const originalBuffer = entry.buffer.bind(entry);
        const originalStream = entry.stream.bind(entry);
        entry.buffer = (...rest: any[]) => {
          record();
          return originalBuffer(...rest);
        };
        entry.stream = (...rest: any[]) => {
          record();
          return originalStream(...rest);
        };
      }
      return zip;
    });
  return { counts, restore: () => spy.mockRestore() };
}

describe("workbook part byte budget", () => {
  /**
   * 20 MB of XML that deflates to ~20 KB, with the central directory claiming
   * the part inflates to a single byte.
   */
  function craftLyingChartPackage(): Buffer {
    return craftZip([
      {
        path: "xl/charts/chart1.xml",
        content:
          `<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:barChart>` +
          `<c:barDir val="col"/></c:barChart></c:plotArea></c:chart>` +
          `<!--${"A".repeat(20_000_000)}--></c:chartSpace>`,
        declaredUncompressedSize: 1,
      },
    ]);
  }

  it("refuses a part whose declared size lies about what it inflates to", async () => {
    const service = createService();
    const buffer = craftLyingChartPackage();

    // A few tens of KB on the wire, twenty megabytes once inflated.
    expect(buffer.length).toBeLessThan(100_000);

    const result = await (service as any).extractExcelChartsAndImages(buffer);

    const oversized = warnPayloads(service, "xlsx.part.oversized");
    expect(oversized).toHaveLength(1);
    expect(oversized[0].part).toBe("xl/charts/chart1.xml");
    // The zip's own claim was well under the cap...
    expect(oversized[0].declaredSize).toBeLessThan(PART_BYTE_CAP);
    // ...and the cap still tripped, on bytes that were really produced.
    expect(oversized[0].observedSize).toBeGreaterThan(PART_BYTE_CAP);

    // Nothing from the oversized part reaches the grader.
    expect(result.section).toContain("(unable to parse)");
    expect(result.section.length).toBeLessThan(10_000);
  });

  it("reads a part that honestly declares a size within the budget", async () => {
    const service = createService();
    const buffer = craftZip([
      {
        path: "xl/charts/chart1.xml",
        content:
          `<c:chartSpace xmlns:c="c"><c:chart><c:title><c:tx><c:rich><a:t>Honest</a:t>` +
          `</c:rich></c:tx></c:title><c:plotArea><c:barChart><c:barDir val="col"/>` +
          `</c:barChart></c:plotArea><c:legend><c:legendPos val="r"/></c:legend>` +
          `</c:chart></c:chartSpace>`,
      },
    ]);

    const result = await (service as any).extractExcelChartsAndImages(buffer);

    expect(result.chartCount).toBe(1);
    expect(result.section).toContain('Column Chart - "Honest"');
    expect(result.section).toContain("Legend: present (right)");
    expect(warnPayloads(service, "xlsx.part.oversized")).toEqual([]);
  });

  it("refuses a part that declares an over-budget size without inflating it", async () => {
    const service = createService();
    const buffer = craftZip([
      {
        path: "xl/charts/chart1.xml",
        content: `<c:chartSpace xmlns:c="c"/>`,
        declaredUncompressedSize: 40_000_000,
      },
    ]);
    const { counts, restore } = countInflations();

    let result: { section: string };
    try {
      result = await (service as any).extractExcelChartsAndImages(buffer);
    } finally {
      restore();
    }

    const oversized = warnPayloads(service, "xlsx.part.oversized");
    expect(oversized).toHaveLength(1);
    expect(oversized[0].declaredSize).toBeGreaterThan(PART_BYTE_CAP);
    // The declared size alone is enough; no decompression is attempted.
    expect(oversized[0].observedSize).toBeUndefined();
    expect(counts.get("xl/charts/chart1.xml")).toBeUndefined();
    expect(result!.section).toContain("(unable to parse)");
  });
});

describe("workbook pivot XML scanning cost", () => {
  /**
   * A pivot part whose every layout element is an unclosed opening tag. Each
   * opener is a fresh starting point for any search that scans forward looking
   * for a closer that is not there.
   */
  function craftUnclosedPivotPackage(): Buffer {
    const openers: string[] = ['<pivotTableDefinition name="Adversarial">'];
    for (let index = 0; index < 9000; index++) {
      openers.push("<pivotFields a><dataFields a><rowFields a><colFields a>");
    }
    const pivotXml = openers.join("");
    expect(pivotXml.length).toBeLessThan(PART_BYTE_CAP);

    return craftZip([
      { path: "xl/pivotTables/pivotTable1.xml", content: pivotXml },
    ]);
  }

  it("scans a pivot part with no closing tags in bounded time", async () => {
    const service = createService();
    const buffer = craftUnclosedPivotPackage();

    const startedAt = Date.now();
    const result = await (service as any).extractExcelChartsAndImages(buffer);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(1000);

    // And it still describes the pivot table, just with nothing in its areas.
    expect(result.pivotCount).toBe(1);
    expect(result.section).toContain('Pivot table "Adversarial"');
    expect(result.section).toContain("Row fields: (none)");
    expect(result.section).toContain("Column fields: (none)");
    expect(result.section).toContain("Data fields: (none)");
  });

  it("still reads pivot layout out of a well formed pivot part", async () => {
    const service = createService();
    const buffer = craftZip([
      {
        path: "xl/pivotTables/pivotTable1.xml",
        content:
          `<pivotTableDefinition name="Honest">` +
          `<pivotFields count="2"><pivotField axis="axisRow" sortType="descending"/>` +
          `<pivotField axis="axisCol"/></pivotFields>` +
          `<rowFields count="1"><field x="0"/></rowFields>` +
          `<colFields count="1"><field x="1"/></colFields>` +
          `<dataFields count="1"><dataField name="Sum of Revenue" fld="1"/></dataFields>` +
          `</pivotTableDefinition>`,
      },
      {
        path: "xl/pivotTables/_rels/pivotTable1.xml.rels",
        content:
          `<Relationships><Relationship Id="rId1" ` +
          `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" ` +
          `Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`,
      },
      {
        path: "xl/pivotCache/pivotCacheDefinition1.xml",
        content:
          `<pivotCacheDefinition><cacheSource><worksheetSource sheet="SalesData" ref="A1:D9"/>` +
          `</cacheSource><cacheFields count="2"><cacheField name="Region"/>` +
          `<cacheField name="Revenue"/></cacheFields></pivotCacheDefinition>`,
      },
    ]);

    const result = await (service as any).extractExcelChartsAndImages(buffer);

    expect(result.pivotCount).toBe(1);
    expect(result.section).toContain("source: SalesData!A1:D9");
    expect(result.section).toContain("Row fields: Region (sorted descending)");
    expect(result.section).toContain("Column fields: Revenue");
    expect(result.section).toContain("Data fields: Sum of Revenue");
  });
});

describe("workbook relationship walk", () => {
  const DRAWING_TYPE =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
  const WORKSHEET_TYPE =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

  /**
   * A package that cross-links itself: hundreds of worksheets, one worksheet
   * declaring thousands of relationships that all resolve to the same drawing,
   * and that drawing's relationship part being the worksheet's own — so the
   * walk keeps arriving back where it started.
   */
  function craftCrossLinkedPackage(): Buffer {
    const sheetCount = 250;
    const relationshipsPerSheet = 400;

    const sheets: string[] = [];
    const workbookRelationships: string[] = [];
    for (let index = 1; index <= sheetCount; index++) {
      sheets.push(
        `<sheet name="S${index}" sheetId="${index}" r:id="rId${index}"/>`,
      );
      workbookRelationships.push(
        `<Relationship Id="rId${index}" Type="${WORKSHEET_TYPE}" ` +
          `Target="worksheets/sheet1.xml"/>`,
      );
    }

    const sheetRelationships: string[] = [];
    for (let index = 1; index <= relationshipsPerSheet; index++) {
      // Every one of these resolves to xl/worksheets/sheet1.xml, whose own
      // relationship part is the part currently being walked.
      sheetRelationships.push(
        `<Relationship Id="d${index}" Type="${DRAWING_TYPE}" Target="sheet1.xml"/>`,
      );
    }

    return craftZip([
      {
        path: "xl/workbook.xml",
        content: `<workbook><sheets>${sheets.join("")}</sheets></workbook>`,
      },
      {
        path: "xl/_rels/workbook.xml.rels",
        content: `<Relationships>${workbookRelationships.join("")}</Relationships>`,
      },
      {
        path: "xl/worksheets/_rels/sheet1.xml.rels",
        content: `<Relationships>${sheetRelationships.join("")}</Relationships>`,
      },
      { path: "xl/worksheets/sheet1.xml", content: "<worksheet/>" },
    ]);
  }

  it("never decompresses the same package part twice", async () => {
    const service = createService();
    const buffer = craftCrossLinkedPackage();
    const { counts, restore } = countInflations();

    try {
      await (service as any).extractExcelChartsAndImages(buffer);
    } finally {
      restore();
    }

    const repeated = [...counts.entries()].filter(([, times]) => times > 1);
    expect(repeated).toEqual([]);
  }, 120_000);

  it("bounds the number of parts the relationship walk visits", async () => {
    const service = createService();
    const buffer = craftCrossLinkedPackage();
    const { counts, restore } = countInflations();

    const startedAt = Date.now();
    try {
      await (service as any).extractExcelChartsAndImages(buffer);
    } finally {
      restore();
    }
    const elapsed = Date.now() - startedAt;

    const totalInflations = [...counts.values()].reduce(
      (sum, times) => sum + times,
      0,
    );
    expect(totalInflations).toBeLessThanOrEqual(200);
    expect(elapsed).toBeLessThan(2000);
  }, 120_000);

  it("still attributes a chart to the worksheet that hosts it", async () => {
    const service = createService();
    const chartType =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
    const buffer = craftZip([
      {
        path: "xl/workbook.xml",
        content: `<workbook><sheets><sheet name="Dashboard" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      },
      {
        path: "xl/_rels/workbook.xml.rels",
        content: `<Relationships><Relationship Id="rId1" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet1.xml"/></Relationships>`,
      },
      {
        path: "xl/worksheets/_rels/sheet1.xml.rels",
        content: `<Relationships><Relationship Id="rId9" Type="${DRAWING_TYPE}" Target="../drawings/drawing1.xml"/></Relationships>`,
      },
      {
        path: "xl/drawings/_rels/drawing1.xml.rels",
        content: `<Relationships><Relationship Id="rId1" Type="${chartType}" Target="../charts/chart1.xml"/></Relationships>`,
      },
      {
        path: "xl/charts/chart1.xml",
        content: `<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:lineChart/></c:plotArea></c:chart></c:chartSpace>`,
      },
    ]);

    const result = await (service as any).extractExcelChartsAndImages(buffer);

    expect(result.section).toContain('Chart 1 on sheet "Dashboard"');
    expect(result.section).toContain("Line Chart");
  });
});
