/* Run against compiled code inside BOTH deployed images; never calls an LLM.
   node <this-script> /app/apps/api/dist/api/attempt/artifacts/parser */
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { join } = require("node:path");
const directory = process.argv[2];
const localRequire = createRequire(
  join(directory, "isolated-artifact-parser.js"),
);
const { parseArtifactIsolated } = localRequire("./isolated-artifact-parser");
const { PDFDocument, StandardFonts } = localRequire("pdf-lib");
(async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("first page content\n".repeat(20), {
    font,
    size: 10,
    x: 20,
    y: 700,
  });
  pdf.addPage().drawText("FINAL PAGE EVIDENCE", { font });
  const bytes = Buffer.from(await pdf.save());
  const output = await parseArtifactIsolated(bytes, "pdf");
  assert.equal(output.blocks[1].text, "FINAL PAGE EVIDENCE");
  assert.ok(output.blocks[0].text.length > 200);
  assert.equal(output.omissions.length, 0);
  await assert.rejects(parseArtifactIsolated(Buffer.from("broken"), "pdf"), {
    code: "corrupt_input",
  });
  await assert.rejects(
    parseArtifactIsolated(bytes, "pdf", "", undefined, { pages: 1 }),
    { code: "expansion_limit" },
  );
  await assert.rejects(
    parseArtifactIsolated(bytes, "pdf", "", undefined, { timeoutMs: 1 }),
    { code: "timeout" },
  );
  const controller = new AbortController();
  const parsing = parseArtifactIsolated(bytes, "pdf", "", controller.signal);
  controller.abort();
  await assert.rejects(parsing, { code: "cancelled" });
  const sharp = localRequire("sharp");
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const image = await parseArtifactIsolated(png, "image", "fixture.png");
  assert.ok(image.blocks.some((block) => block.kind === "image"));
  const JSZip = localRequire("jszip");
  const zip = async (entries) => {
    const archive = new JSZip();
    for (const [path, value] of Object.entries(entries))
      archive.file(path, value);
    return archive.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
  };
  const archive = await parseArtifactIsolated(
    await zip({ "src/main.ts": "const answer = 42;\n// FINAL SOURCE" }),
    "archive",
    "source.zip",
  );
  assert.ok(
    archive.blocks.some((block) => block.text.includes("FINAL SOURCE")),
  );
  const notebook = await parseArtifactIsolated(
    Buffer.from(
      JSON.stringify({
        nbformat: 4,
        cells: [
          {
            cell_type: "code",
            source: "print(42)",
            outputs: [
              {
                output_type: "display_data",
                data: { "image/png": png.toString("base64") },
              },
            ],
          },
        ],
      }),
    ),
    "notebook",
    "plot.ipynb",
  );
  assert.equal(notebook.resources.length, 1);
  const sheet = await parseArtifactIsolated(
    await zip({
      "xl/workbook.xml":
        '<workbook xmlns:r="urn:r"><sheets><sheet name="Sparse" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="9000"><c r="XFD9000" t="inlineStr"><is><t>DECISIVE</t></is></c></row></sheetData></worksheet>',
    }),
    "spreadsheet",
    "sparse.xlsx",
  );
  assert.equal(sheet.blocks[0].location.cell, "XFD9000");
  const word = await parseArtifactIsolated(
    await zip({
      "word/document.xml":
        '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>DOCUMENT FINAL</w:t></w:r></w:p></w:body></w:document>',
    }),
    "document",
    "evidence.docx",
  );
  assert.equal(word.blocks[0].text, "DOCUMENT FINAL");
  const slides = await parseArtifactIsolated(
    await zip({
      "ppt/presentation.xml":
        '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="first"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels":
        '<Relationships><Relationship Id="first" Target="slides/slide1.xml"/></Relationships>',
      "ppt/slides/slide1.xml": "<sld><p><t>SLIDE EVIDENCE</t></p></sld>",
    }),
    "presentation",
    "evidence.pptx",
  );
  assert.equal(slides.blocks[0].location.slide, 1);
  const html = await parseArtifactIsolated(
    Buffer.from(
      '<html><body>URL EVIDENCE<script>fetch("http://example.test")</script></body></html>',
    ),
    "url",
    "source.html",
  );
  assert.equal(html.blocks[0].text, "URL EVIDENCE");
  assert.ok(html.omissions.length > 0);
  const peak = await Promise.all(
    Array.from({ length: 4 }, () => parseArtifactIsolated(bytes, "pdf")),
  );
  assert.equal(peak.length, 4);
  console.log(
    "Isolated parser image smoke passed: PDF/native image/notebook plot/archive/sparse XLSX/DOCX/PPTX/URL/corrupt/limits/cancellation/4 concurrent.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
