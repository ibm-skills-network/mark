import JSZip from "jszip";
import { chartWorkbook, plainWorkbook } from "./tests/office-fixtures";
import {
  chartSheetsWorkbook,
  fitSheetToOnePage,
  sheetHasDrawing,
  showOnlySheets,
} from "./xlsx-render";

const NS = `xmlns="main" xmlns:r="rel"`;
const FIT = `<pageSetUpPr fitToPage="1"/>`;
const SETUP = `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="1"/>`;

describe("sheetHasDrawing", () => {
  it("finds a drawing element, prefixed or not, but not a legacyDrawing", () => {
    expect(
      sheetHasDrawing(`<worksheet><drawing r:id="rId1"/></worksheet>`),
    ).toBe(true);
    expect(
      sheetHasDrawing(`<x:worksheet><x:drawing r:id="a"/></x:worksheet>`),
    ).toBe(true);
    expect(
      sheetHasDrawing(`<worksheet><legacyDrawing r:id="rId1"/></worksheet>`),
    ).toBe(false);
  });
});

describe("fitSheetToOnePage", () => {
  it("adds sheetPr first and pageSetup right after pageMargins", () => {
    const xml = `<worksheet ${NS}><dimension ref="A1"/><sheetData/><pageMargins left="0.7"/><drawing r:id="rId1"/></worksheet>`;
    expect(fitSheetToOnePage(xml)).toBe(
      `<worksheet ${NS}><sheetPr>${FIT}</sheetPr><dimension ref="A1"/><sheetData/><pageMargins left="0.7"/>${SETUP}<drawing r:id="rId1"/></worksheet>`,
    );
  });

  it("opens a self-closing sheetPr and keeps its attributes", () => {
    const xml = `<worksheet ${NS}><sheetPr codeName="S1"/><sheetData/><pageMargins/><drawing r:id="a"/></worksheet>`;
    expect(fitSheetToOnePage(xml)).toContain(
      `<sheetPr codeName="S1">${FIT}</sheetPr>`,
    );
  });

  it("replaces an existing pageSetUpPr and keeps the other sheetPr children first", () => {
    const xml = `<worksheet ${NS}><sheetPr><tabColor rgb="FF0000"/><pageSetUpPr autoPageBreaks="0"/></sheetPr><sheetData/><pageMargins/><drawing r:id="a"/></worksheet>`;
    const out = fitSheetToOnePage(xml);
    expect(out).toContain(`<sheetPr><tabColor rgb="FF0000"/>${FIT}</sheetPr>`);
    expect(out).not.toContain("autoPageBreaks");
  });

  it("replaces an existing pageSetup in place and drops manual page breaks", () => {
    const xml = `<worksheet ${NS}><sheetData/><pageMargins/><pageSetup paperSize="9" orientation="portrait" r:id="rId9"/><headerFooter/><rowBreaks count="1"><brk id="40" max="16383" man="1"/></rowBreaks><colBreaks count="1"><brk id="5"/></colBreaks><drawing r:id="a"/></worksheet>`;
    const out = fitSheetToOnePage(xml);
    expect(out).toContain(`<pageMargins/>${SETUP}<headerFooter/>`);
    expect(out.match(/<pageSetup\b/g)).toHaveLength(1);
    expect(out).not.toContain("portrait");
    expect(out).not.toContain("Breaks");
  });

  it("without pageMargins, puts pageSetup before the first later element", () => {
    const xml = `<worksheet ${NS}><sheetData/><ignoredErrors/><drawing r:id="a"/></worksheet>`;
    expect(fitSheetToOnePage(xml)).toContain(
      `<sheetData/>${SETUP}<ignoredErrors/><drawing r:id="a"/>`,
    );
  });

  it("keeps a namespace prefix on the elements it writes", () => {
    const xml = `<x:worksheet xmlns:x="main"><x:sheetData/><x:pageMargins/><x:drawing r:id="a"/></x:worksheet>`;
    const out = fitSheetToOnePage(xml);
    expect(out).toContain(
      `<x:sheetPr><x:pageSetUpPr fitToPage="1"/></x:sheetPr>`,
    );
    expect(out).toContain(
      `<x:pageMargins/><x:pageSetup orientation="landscape" fitToWidth="1" fitToHeight="1"/>`,
    );
  });

  it("leaves XML that is not a worksheet alone", () => {
    expect(fitSheetToOnePage("<chartsheet/>")).toBe("<chartsheet/>");
  });
});

describe("showOnlySheets", () => {
  const workbook = `<workbook ${NS}><bookViews><workbookView activeTab="0" firstSheet="0"/></bookViews><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Chart" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Notes" sheetId="3" r:id="rId3" state="veryHidden"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="1">Chart!$A$1:$B$2</definedName><definedName name="Rate">Data!$B$1</definedName></definedNames></workbook>`;

  it("hides every other sheet, shows the chosen one and makes it active", () => {
    const out = showOnlySheets(workbook, new Set(["rId2"]));
    expect(out).toContain(
      `<sheet name="Data" sheetId="1" r:id="rId1" state="hidden"/>`,
    );
    expect(out).toContain(`<sheet name="Chart" sheetId="2" r:id="rId2"/>`);
    expect(out).toContain(
      `<sheet name="Notes" sheetId="3" r:id="rId3" state="hidden"/>`,
    );
    expect(out).toContain(`<workbookView activeTab="1"/>`);
  });

  it("drops print areas and keeps other defined names", () => {
    const out = showOnlySheets(workbook, new Set(["rId2"]));
    expect(out).not.toContain("Print_Area");
    expect(out).toContain(`<definedName name="Rate">Data!$B$1</definedName>`);
  });

  it("adds a workbook view before sheets when there is none", () => {
    const out = showOnlySheets(
      `<workbook ${NS}><workbookPr/><sheets><sheet name="A" r:id="rId1"/><sheet name="B" r:id="rId2"/></sheets></workbook>`,
      new Set(["rId2"]),
    );
    expect(out).toContain(
      `<workbookPr/><bookViews><workbookView activeTab="1"/></bookViews><sheets>`,
    );
  });
});

describe("chartSheetsWorkbook", () => {
  it("is undefined when no sheet has a drawing", async () => {
    await expect(chartSheetsWorkbook(plainWorkbook())).resolves.toBeUndefined();
  });

  it("keeps only the chart sheet visible, fitted to one page", async () => {
    const prepared = await chartSheetsWorkbook(await chartWorkbook(50));
    expect(prepared?.sheets).toEqual(["Dashboard"]);
    const zip = await JSZip.loadAsync(prepared?.buffer ?? Buffer.alloc(0));
    const workbook = await zip.file("xl/workbook.xml")?.async("string");
    expect(workbook).toContain(
      `name="Data" sheetId="1" r:id="rId1" state="hidden"`,
    );
    expect(workbook).toContain(
      `name="Notes" sheetId="2" r:id="rId2" state="hidden"`,
    );
    expect(workbook).toMatch(/name="Dashboard" sheetId="3" r:id="rId3"\/>/);
    const dashboard = await zip
      .file("xl/worksheets/sheet3.xml")
      ?.async("string");
    expect(dashboard).toContain(FIT);
    expect(dashboard).toContain(SETUP);
    const data = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    expect(data).not.toContain("pageSetup");
    // Chart parts are carried over untouched.
    expect(zip.file("xl/charts/chart1.xml")).not.toBeNull();
  });

  it("is undefined for a workbook without workbook.xml", async () => {
    const zip = new JSZip();
    zip.file("xl/worksheets/sheet1.xml", "<worksheet><drawing/></worksheet>");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(chartSheetsWorkbook(buffer)).resolves.toBeUndefined();
  });
});
