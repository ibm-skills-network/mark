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
  pdf
    .addPage()
    .drawText("first page content\n".repeat(20), {
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
  const peak = await Promise.all(
    Array.from({ length: 4 }, () => parseArtifactIsolated(bytes, "pdf")),
  );
  assert.equal(peak.length, 4);
  console.log(
    "Isolated parser image smoke passed: PDF late-page/native image/corrupt/limits/cancellation/4 concurrent.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
