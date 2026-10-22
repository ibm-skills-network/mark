import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { parseArtifactIsolated as Parse } from "./isolated-artifact-parser";

describe("isolated artifact parser (real child and PDF dependency)", () => {
  let folder: string;
  let parse: typeof Parse;
  let document: Buffer;
  beforeAll(async () => {
    folder = mkdtempSync(join(process.cwd(), ".parser-test-"));
    for (const name of [
      "artifact.worker",
      "adapter-pdf",
      "adapter-url",
      "isolated-artifact-parser",
    ]) {
      writeFileSync(
        join(folder, `${name}.js`),
        transpileModule(readFileSync(join(__dirname, `${name}.ts`), "utf8"), {
          compilerOptions: {
            target: ScriptTarget.ES2022,
            module: ModuleKind.CommonJS,
          },
        }).outputText,
      );
    }
    parse = require(
      join(folder, "isolated-artifact-parser.js"),
    ).parseArtifactIsolated;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("FIRST " + ("a".repeat(70) + "\n").repeat(5), {
      font,
      size: 10,
      x: 20,
      y: 700,
    });
    pdf.addPage().drawText("DECISIVE FINAL PAGE", { font });
    document = Buffer.from(await pdf.save());
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  it("preserves late evidence with page locations", async () => {
    const result = await parse(document, "pdf");
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].text.length).toBeGreaterThan(200);
    expect(result.blocks[1]).toMatchObject({
      text: "DECISIVE FINAL PAGE",
      location: { page: 2 },
    });
    expect(result.omissions).toEqual([]);
  });
  it("does not label vector evidence complete", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawRectangle({
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      color: rgb(1, 0, 0),
    });
    const result = await parse(Buffer.from(await pdf.save()), "pdf");
    expect(result.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_visual_evidence",
          location: { page: 1 },
        }),
      ]),
    );
    expect(result.empty).toBe(false);
  });
  it("rejects corrupt PDF while unrelated text succeeds", async () => {
    const results = await Promise.allSettled([
      parse(Buffer.from("not a pdf"), "pdf"),
      parse(Buffer.from("healthy"), "text"),
    ]);
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { code: "corrupt_input" },
    });
    expect(results[1]).toMatchObject({
      status: "fulfilled",
      value: { blocks: [{ text: "healthy" }] },
    });
  });
  it("bounds page expansion", async () => {
    await expect(
      parse(document, "pdf", "", undefined, { pages: 1 }),
    ).rejects.toMatchObject({ code: "expansion_limit" });
  });
  it("bounds input and output", async () => {
    await expect(
      parse(document, "pdf", "", undefined, { inputBytes: 1 }),
    ).rejects.toMatchObject({ code: "input_limit" });
    await expect(
      parse(Buffer.from("hello"), "text", "", undefined, { outputBytes: 10 }),
    ).rejects.toMatchObject({ code: "output_limit" });
  });
  it("kills a worker that exceeds the RSS budget", async () => {
    await expect(
      parse(document, "pdf", "", undefined, { rssMb: 1 }),
    ).rejects.toMatchObject({ code: "expansion_limit" });
  });
  it("kills overdue work before returning", async () => {
    await expect(
      parse(document, "pdf", "", undefined, { timeoutMs: 1 }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(
      (await parse(Buffer.from("after timeout"), "text")).blocks[0].text,
    ).toBe("after timeout");
  });
  it("cancels before spawn and during parsing", async () => {
    const before = new AbortController();
    before.abort();
    await expect(
      parse(document, "pdf", "", before.signal),
    ).rejects.toMatchObject({ code: "cancelled" });
    const during = new AbortController();
    const pending = parse(document, "pdf", "", during.signal);
    during.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
  it("never executes or fetches dynamic URL content", async () => {
    const result = await parse(
      Buffer.from(
        '<html><body>Late required text<script>fetch("http://127.0.0.1")</script><img src="http://127.0.0.1/private"></body></html>',
      ),
      "url",
      "remote.html",
    );
    expect(result.blocks[0].text).toBe("Late required text");
    expect(result.omissions.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "missing_visual_evidence",
        "unsupported_feature",
      ]),
    );
  });
  it("denies public network calls, filesystem writes, subprocesses and inherited secrets", async () => {
    const adapter = join(folder, "adapter-pdf.js");
    const original = readFileSync(adapter);
    process.env.MARK_PARSER_ISOLATION_TEST = "synthetic-environment-value";
    writeFileSync(
      adapter,
      `exports.extractPdf = async () => {
      let blocked = 0;
      for (const operation of [() => require('node:net').connect(80, '127.0.0.1'), () => require('node:fs').writeFileSync('/tmp/mark-parser-denied', 'bad'), () => require('node:child_process').spawn('true')]) {
        try { operation(); } catch { blocked++; }
      }
      return { blocks: [{kind:'text',text:String(blocked + (process.env.MARK_PARSER_ISOLATION_TEST ? 0 : 1)),location:{}}], omissions:[], expandedBytes:0 };
    };`,
    );
    try {
      expect((await parse(Buffer.alloc(0), "pdf")).blocks[0].text).toBe("4");
    } finally {
      writeFileSync(adapter, original);
      delete process.env.MARK_PARSER_ISOLATION_TEST;
    }
  });
  it("records legitimately empty input", async () => {
    expect(await parse(Buffer.alloc(0), "text")).toMatchObject({
      blocks: [],
      omissions: [],
      empty: true,
    });
  });
});
