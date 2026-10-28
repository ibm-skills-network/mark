import JSZip from "jszip";
import * as XLSX from "xlsx";
import type { Part } from "./contracts";
import {
  bytesToParts,
  DEFAULT_MATERIALIZE_LIMITS,
  materialize,
  type MaterializeLimits,
  type SubmissionFile,
} from "./materialize";

function file(
  name: string,
  content: Buffer | string,
  mimeType?: string,
): SubmissionFile {
  const buffer = typeof content === "string" ? Buffer.from(content) : content;
  return {
    name,
    mimeType,
    size: buffer.length,
    load: () => Promise.resolve(buffer),
  };
}

function workbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Cover");
  const data = XLSX.utils.aoa_to_sheet([
    ["item", "qty", "price"],
    ["apple", 3, 0.5],
    ["pear", 2, 0.75],
  ]);
  data.D2 = { t: "n", v: 1.5, f: "B2*C2" };
  data.D3 = { t: "n", v: 1.5, f: "B3*C3" };
  data["!ref"] = "A1:D3";
  XLSX.utils.book_append_sheet(workbook, data, "Totals");
  const hidden = XLSX.utils.aoa_to_sheet([["scratch", 7]]);
  XLSX.utils.book_append_sheet(workbook, hidden, "Scratch");
  workbook.Workbook = { Sheets: [{}, {}, { Hidden: 1 }] };
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function textOf(parts: Part[], name: string): string {
  const part = parts.find((item) => item.name === name);
  if (!part)
    throw new Error(
      `no part ${name}; have ${parts.map((p) => p.name).join(", ")}`,
    );
  return part.text ?? "";
}

async function ok(result: ReturnType<typeof materialize>) {
  const resolved = await result;
  if (resolved.ok === false)
    throw new Error(`materialize failed: ${resolved.message}`);
  return resolved;
}

describe("materialize: formats", () => {
  it("reads every sheet of an xlsx, including content only on sheet 2", async () => {
    const { parts } = await ok(
      materialize({ files: [file("budget.xlsx", workbookBuffer())] }),
    );
    const totals = textOf(parts, "budget.xlsx › Totals");
    expect(totals).toContain("apple,3,0.5");
    expect(totals).toContain("pear,2,0.75");
    expect(textOf(parts, "budget.xlsx › Cover")).toContain("(empty sheet)");
  });

  it("includes formulas alongside values", async () => {
    const { parts } = await ok(
      materialize({ files: [file("budget.xlsx", workbookBuffer())] }),
    );
    const formulas = textOf(parts, "budget.xlsx › Totals (formulas)");
    expect(formulas).toContain("D2: =B2*C2");
    expect(formulas).toContain("D3: =B3*C3");
    expect(textOf(parts, "budget.xlsx › Totals")).toContain("1.5");
  });

  it("includes hidden sheets and says they are hidden", async () => {
    const { parts } = await ok(
      materialize({ files: [file("budget.xlsx", workbookBuffer())] }),
    );
    expect(textOf(parts, "budget.xlsx › Scratch")).toContain("(hidden sheet)");
  });

  it("turns an unknown type into a could-not-read part", async () => {
    const { parts } = await ok(
      materialize({ files: [file("deck.numbers", Buffer.from([1, 2, 3]))] }),
    );
    expect(parts).toEqual([
      {
        name: "deck.numbers",
        kind: "text",
        text: "could not read deck.numbers (numbers)",
      },
    ]);
  });

  it("sends pdf and images natively", async () => {
    const parts = [
      ...(await bytesToParts(
        "r.pdf",
        undefined,
        Buffer.from("%PDF-1.4 /Type /Page"),
      )),
      ...(await bytesToParts("shot.PNG", undefined, Buffer.from("png"))),
    ];
    expect(parts.map((part) => [part.kind, part.mimeType])).toEqual([
      ["file", "application/pdf"],
      ["image", "image/png"],
    ]);
  });

  it("sends a 40-page pdf whole, past the text per-file cap", async () => {
    const pdf = Buffer.from(`%PDF-1.4 ${"/Type /Page\n".repeat(40)}`);
    const result = await materialize({
      files: [
        { name: "capstone.pdf", size: pdf.length, load: async () => pdf },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts.map((part) => [part.name, part.kind])).toEqual([
      ["capstone.pdf", "file"],
    ]);
  });

  it("reads code and text as text, and refuses binary bytes in a text file", async () => {
    expect(
      (await bytesToParts("main.py", undefined, Buffer.from("print(1)")))[0]
        .text,
    ).toBe("print(1)");
    const binary = await bytesToParts(
      "notes.txt",
      undefined,
      Buffer.from([0, 1, 2]),
    );
    expect(binary[0].text).toContain("could not read notes.txt");
  });

  it("reads a notebook with its text outputs and image outputs as images", async () => {
    const notebook = JSON.stringify({
      cells: [
        { cell_type: "markdown", source: ["# Title"] },
        {
          cell_type: "code",
          source: "print(2+2)",
          outputs: [
            { output_type: "stream", text: ["4\n"] },
            { output_type: "display_data", data: { "image/png": "AAAA" } },
          ],
        },
      ],
    });
    const { parts } = await ok(
      materialize({ files: [file("nb.ipynb", notebook)] }),
    );
    const text = textOf(parts, "nb.ipynb");
    expect(text.indexOf("# Title")).toBeLessThan(text.indexOf("print(2+2)"));
    expect(text).toContain("4\n");
    expect(parts.find((part) => part.kind === "image")?.name).toBe(
      "nb.ipynb › output image 1 (cell 2)",
    );
  });

  it("adds a charts part naming each chart's kind and sheet", async () => {
    const zip = await JSZip.loadAsync(workbookBuffer());
    zip.file(
      "xl/worksheets/_rels/sheet2.xml.rels",
      '<Relationships><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    );
    zip.file(
      "xl/drawings/_rels/drawing1.xml.rels",
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
    );
    zip.file(
      "xl/charts/chart1.xml",
      '<c:chartSpace><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:tx><c:v>qty</c:v></c:tx><c:val><c:numRef><c:f>Totals!$B$2:$B$3</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea><c:legend/></c:chart></c:chartSpace>',
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const { parts } = await ok(
      materialize({ files: [file("budget.xlsx", buffer)] }),
    );
    const charts = textOf(parts, "budget.xlsx (charts)");
    expect(charts).toContain('chart 1 (on sheet "Totals")');
    expect(charts).toContain("type: column chart");
    expect(charts).toContain("legend: yes");
    expect(charts).toContain("values=Totals!$B$2:$B$3");
  });
});

describe("materialize: limits", () => {
  const small: MaterializeLimits = {
    ...DEFAULT_MATERIALIZE_LIMITS,
    maxFileBytes: 10,
  };

  it("fails a file over the byte limit instead of truncating it", async () => {
    const result = await materialize(
      { files: [file("big.txt", "x".repeat(11))] },
      {},
      small,
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: "part_too_large",
        partName: "big.txt",
      }),
    );
  });

  it("checks a declared size before loading the bytes", async () => {
    const load = jest.fn();
    const result = await materialize(
      { files: [{ name: "big.pdf", size: 11, load }] },
      {},
      small,
    );
    expect(result.ok).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("fails when fixed parts alone are over the token budget", async () => {
    const result = await materialize(
      { text: "word ".repeat(2000) },
      {},
      { ...DEFAULT_MATERIALIZE_LIMITS, tokenBudget: 100 },
    );
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: "over_budget" }),
    );
  });

  it("abridges a long CSV with head, tail, counts and a visible marker", async () => {
    const rows = [
      "id,value",
      ...Array.from(
        { length: 5000 },
        (_, index) => `${index},${"v".repeat(40)}`,
      ),
    ];
    const { parts } = await ok(
      materialize(
        { files: [file("data.csv", rows.join("\n"))] },
        {},
        { ...DEFAULT_MATERIALIZE_LIMITS, maxTokensPerFile: 20_000 },
      ),
    );
    const text = textOf(parts, "data.csv");
    expect(text).toContain(
      "[abridged: 5000 data rows × 2 columns; rows 201–4980 omitted]",
    );
    expect(text).toContain("id,value");
    expect(text).toContain("199,");
    expect(text).not.toContain("\n2000,");
    expect(text).toContain("4999,");
  });

  it("abridges long prose with start, end and an omission marker", async () => {
    const body = `START ${"lorem ipsum ".repeat(30_000)} END`;
    const { parts } = await ok(
      materialize({ files: [file("essay.md", body)] }),
    );
    const text = textOf(parts, "essay.md");
    expect(text).toMatch(/^\[abridged: /);
    expect(text).toContain("START");
    expect(text).toContain("END");
    expect(text).toMatch(/\[\.\.\. \d+ characters omitted \.\.\.\]/);
  });

  it("lists skip-list files instead of reading them", async () => {
    const load = jest.fn();
    const { parts, stats } = await ok(
      materialize({
        files: [
          { name: "yarn.lock", load },
          { name: "model.pkl", load },
          file("main.py", "print(1)"),
        ],
      }),
    );
    expect(load).not.toHaveBeenCalled();
    const skipped = textOf(parts, "skipped files");
    expect(skipped).toContain("yarn.lock");
    expect(skipped).toContain("model.pkl");
    expect(stats).toEqual(
      expect.objectContaining({ filesSeen: 3, filesSent: 1, filesSkipped: 2 }),
    );
  });

  it("expands a zip, skipping node_modules and lockfiles before reading them", async () => {
    const zip = new JSZip();
    zip.file("project/app.js", "console.log('hi')");
    zip.file("project/node_modules/left-pad/index.js", "module.exports = 1");
    zip.file("project/package-lock.json", "{}");
    zip.file("project/dist/app.min.js", "x");
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const { parts } = await ok(
      materialize({ files: [file("work.zip", buffer)] }),
    );
    expect(textOf(parts, "work.zip/project/app.js")).toBe("console.log('hi')");
    const skipped = textOf(parts, "skipped files");
    expect(skipped).toContain(
      "work.zip/project/node_modules/left-pad/index.js: inside node_modules/",
    );
    expect(skipped).toContain("package-lock.json");
    expect(skipped).toContain("work.zip/project/dist/app.min.js");
  });

  it("refuses a zip bomb", async () => {
    const zip = new JSZip();
    zip.file("zeros.txt", "0".repeat(5 * 1024 * 1024));
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const result = await materialize({ files: [file("bomb.zip", buffer)] });
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: "submission_too_large" }),
    );
  });

  it("does not expand archives nested deeper than the limit", async () => {
    const inner = new JSZip();
    inner.file("deep.txt", "deep");
    const innerBuffer = await inner.generateAsync({ type: "nodebuffer" });
    const middle = new JSZip();
    middle.file("inner.zip", innerBuffer);
    const middleBuffer = await middle.generateAsync({ type: "nodebuffer" });
    const outer = new JSZip();
    outer.file("middle.zip", middleBuffer);
    const outerBuffer = await outer.generateAsync({ type: "nodebuffer" });
    const { parts } = await ok(
      materialize({ files: [file("outer.zip", outerBuffer)] }),
    );
    expect(textOf(parts, "skipped files")).toContain(
      "outer.zip/middle.zip/inner.zip: archive nested too deep",
    );
  });

  it("over budget, sends named files first, then code, then data, and lists the rest", async () => {
    const chunk = "a ".repeat(3500); // about 2,000 tokens
    const { parts } = await ok(
      materialize(
        {
          questionContext: "Submit analysis.csv and your code.",
          files: [
            file("extra.csv", chunk),
            file("photo.dat", chunk, "text/plain"),
            file("analysis.csv", chunk),
            file("solve.py", chunk),
          ],
        },
        {},
        { ...DEFAULT_MATERIALIZE_LIMITS, tokenBudget: 4500 },
      ),
    );
    const names = parts.map((part) => part.name);
    expect(names).toEqual(["analysis.csv", "solve.py", "skipped files"]);
    const skipped = textOf(parts, "skipped files");
    expect(skipped).toContain("extra.csv: not sent (budget)");
    expect(skipped).toContain("photo.dat: not sent (budget)");
  });

  it("caps the number of files sent", async () => {
    const files = Array.from({ length: 4 }, (_, index) =>
      file(`f${index}.py`, "x"),
    );
    const { parts, stats } = await ok(
      materialize(
        { files },
        {},
        { ...DEFAULT_MATERIALIZE_LIMITS, maxFilesSent: 2 },
      ),
    );
    expect(stats.filesSent).toBe(2);
    expect(textOf(parts, "skipped files")).toContain(
      "f3.py: not sent (over the 2-file limit)",
    );
  });

  it("estimates tokens and cost", async () => {
    const { stats } = await ok(materialize({ text: "hello world" }));
    expect(stats.estimatedTokens).toBeGreaterThan(0);
    expect(stats.estimatedCostUsd).toBeGreaterThan(0);
  });
});
