import sharp from "sharp";
import {
  extractSpreadsheet,
  extractDocument,
  extractPresentation,
  extractImage,
} from "./media-adapters";
import { craftMediaZip } from "./media-fixtures.test";
import type { ParserLimits } from "./parser.types";
const limits: ParserLimits = {
  inputBytes: 1_000_000,
  expandedBytes: 2_000_000,
  outputBytes: 1_000_000,
  pages: 200,
  timeoutMs: 5000,
  heapMb: 128,
  rssMb: 256,
};
const book = [
  {
    path: "xl/workbook.xml",
    content:
      '<workbook xmlns:r="urn:r"><sheets><sheet name="Sparse" r:id="rId1"/></sheets></workbook>',
  },
  {
    path: "xl/_rels/workbook.xml.rels",
    content:
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  },
];
describe("isolated media adapter primitives", () => {
  it("preserves sparse cells, zero, formulas and decisive evidence after 200 characters", async () => {
    const data = craftMediaZip([
      ...book,
      {
        path: "xl/worksheets/sheet1.xml",
        content: `<worksheet><sheetData><row r="9000"><c r="XFD9000" t="inlineStr"><is><t>${"x".repeat(300)}DECISIVE</t></is></c><c r="A1"><v>0</v></c><c r="A2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`,
      },
    ]);
    const result = await extractSpreadsheet(data, limits, "sparse.xlsx");
    expect(result.blocks[0].location).toEqual({
      sheet: "Sparse",
      cell: "XFD9000",
    });
    expect(result.blocks[0].text).toContain("DECISIVE");
    expect(JSON.parse(result.blocks[1].text!)).toEqual({ value: "0" });
    expect(JSON.parse(result.blocks[2].text!)).toEqual({
      value: "2",
      formula: "1+1",
      calculation: "cached-not-recomputed",
    });
  });
  it("retains alternate-namespace chart XML and explicit visual omissions", async () => {
    const data = craftMediaZip([
      ...book,
      {
        path: "xl/worksheets/sheet1.xml",
        content: "<worksheet><sheetData/><drawing/></worksheet>",
      },
      {
        path: "xl/charts/chart1.xml",
        content:
          '<alt:chartSpace xmlns:alt="urn:chart"><alt:chart><alt:title>Sales</alt:title></alt:chart></alt:chartSpace>',
      },
    ]);
    const result = await extractSpreadsheet(data, limits, "chart.xlsx");
    expect(result.blocks[0].kind).toBe("chart");
    expect(result.blocks[0].text).toContain("Sales");
    expect(result.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_visual_evidence",
          location: { archivePath: "xl/charts/chart1.xml" },
        }),
      ]),
    );
  });
  it("rejects corrupt XML, external entities and hostile archive expansion", async () => {
    await expect(
      extractSpreadsheet(Buffer.from("invalid"), limits, "a.xlsx"),
    ).rejects.toThrow("corrupt_input");
    const xml = craftMediaZip([
      {
        path: "word/document.xml",
        content:
          '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><document>&x;</document>',
      },
    ]);
    await expect(extractDocument(xml, limits, "a.docx")).rejects.toThrow(
      "corrupt_input",
    );
    const bomb = craftMediaZip([
      {
        path: "word/document.xml",
        content: "x".repeat(10000),
        declaredUncompressedSize: 1,
      },
    ]);
    await expect(
      extractDocument(bomb, { ...limits, expandedBytes: 100 }, "a.docx"),
    ).rejects.toThrow("expansion_limit");
  });
  it("preserves document paragraph identity and flags embedded media", async () => {
    const data = craftMediaZip([
      {
        path: "word/document.xml",
        content:
          '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Long</w:t></w:r></w:p><w:p><w:r><w:t>TAIL</w:t></w:r><w:drawing/></w:p></w:body></w:document>',
      },
      { path: "word/media/image1.png", content: Buffer.from([1, 2, 3]) },
    ]);
    const result = await extractDocument(data, limits, "a.docx");
    expect(result.blocks[1]).toEqual({
      kind: "text",
      text: "TAIL",
      location: { archivePath: "word/document.xml", section: "paragraph:2" },
    });
    expect(
      result.omissions.some((o) => o.code === "missing_visual_evidence"),
    ).toBe(true);
  });
  it("uses slide relationship order rather than ZIP filename order", async () => {
    const data = craftMediaZip([
      {
        path: "ppt/presentation.xml",
        content:
          '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>',
      },
      {
        path: "ppt/_rels/presentation.xml.rels",
        content:
          '<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>',
      },
      {
        path: "ppt/slides/slide1.xml",
        content: "<sld><p><t>ONE</t></p></sld>",
      },
      {
        path: "ppt/slides/slide2.xml",
        content: "<sld><p><t>TWO</t></p></sld>",
      },
    ]);
    const result = await extractPresentation(data, limits, "a.pptx");
    expect(result.blocks.map((b) => b.text)).toEqual(["TWO", "ONE"]);
    expect(result.blocks[0].location).toEqual({ slide: 1 });
    expect(result.omissions).toHaveLength(2);
  });
  it("validates image bytes and retains visual original rather than inventing text", async () => {
    const bytes = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const result = await extractImage(bytes, limits, "image.png");
    expect(result.blocks).toEqual([
      {
        kind: "image",
        resourceRef: "original",
        location: { section: "original-image" },
      },
    ]);
    expect(result.omissions).toEqual([]);
    await expect(
      extractImage(bytes, { ...limits, expandedBytes: 4 }, "image.png"),
    ).rejects.toThrow();
    await expect(
      extractImage(Buffer.from("invalid"), limits, "image.png"),
    ).rejects.toThrow();
  });
  it("rejects unrelated XML roots rather than treating corrupt files as empty", async () => {
    const bytes = craftMediaZip([
      { path: "word/document.xml", content: "<notADocument/>" },
    ]);
    await expect(extractDocument(bytes, limits, "a.docx")).rejects.toThrow(
      "corrupt_input",
    );
  });
  it("accounts for omitted spreadsheet display formatting", async () => {
    const bytes = craftMediaZip([
      ...book,
      {
        path: "xl/worksheets/sheet1.xml",
        content:
          '<worksheet><sheetData><row><c r="A1" s="1"><v>45500</v></c></row></sheetData></worksheet>',
      },
    ]);
    const result = await extractSpreadsheet(bytes, limits, "dates.xlsx");
    expect(result.omissions).toEqual([
      expect.objectContaining({
        code: "unsupported_feature",
        location: { sheet: "Sparse" },
      }),
    ]);
    expect(result.blocks[0].text).toContain("45500");
  });
  it("declares legacy variants unsupported rather than misreading arbitrary binaries", async () => {
    for (const [parser, filename] of [
      [extractSpreadsheet, "a.xls"],
      [extractDocument, "a.doc"],
      [extractPresentation, "a.ppt"],
      [extractImage, "a.svg"],
    ] as const)
      await expect(parser(Buffer.alloc(0), limits, filename)).rejects.toThrow(
        "unsupported_format",
      );
  });
});
