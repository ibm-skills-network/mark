import JSZip from "jszip";
import type { Part } from "./contracts";
import type { Renderer, RenderFailure } from "./formats/render";
import {
  chartWorkbook,
  plainWorkbook,
  textDeck,
  textDocument,
} from "./formats/tests/office-fixtures";
import {
  bytesToParts,
  DEFAULT_MATERIALIZE_LIMITS,
  materialize,
  type MaterializeLimits,
} from "./materialize";

/** A PDF-ish buffer the page counter reads as `pages` pages. */
function fakePdf(pages: number): Buffer {
  return Buffer.from(
    `%PDF-1.7\n${Array.from({ length: pages }, () => "<< /Type /Page >>").join("\n")}\n<< /Type /Pages >>`,
    "latin1",
  );
}

interface FakeRenderer extends Renderer {
  calls: Array<{ extension: string; bytes: Buffer }>;
}

function fakeRenderer(
  result: (extension: string) => Buffer | RenderFailure,
): FakeRenderer {
  const calls: FakeRenderer["calls"] = [];
  return {
    calls,
    toPdf(bytes, extension) {
      calls.push({ extension, bytes });
      return Promise.resolve(result(extension));
    },
  };
}

const failed: RenderFailure = { ok: false, code: "failed", message: "boom" };

function names(parts: Part[]): string[] {
  return parts.map((part) => part.name);
}

describe("bytesToParts: rendered pages", () => {
  it("sends a deck's text, and its slides as a PDF checked against the text", async () => {
    const renderer = fakeRenderer(() => fakePdf(2));
    const deck = await textDeck(["Findings", "Method"]);
    const parts = await bytesToParts(
      "deck.pptx",
      undefined,
      deck,
      DEFAULT_MATERIALIZE_LIMITS,
      { renderer },
    );
    expect(names(parts)).toEqual(["deck.pptx", "deck.pptx (slides)"]);
    expect(parts[0].kind).toBe("text");
    expect(parts[0].text).toContain("Findings");
    expect(parts[1]).toMatchObject({
      kind: "file",
      mimeType: "application/pdf",
      verifyAgainst: ["deck.pptx"],
    });
    expect(renderer.calls).toEqual([{ extension: "pptx", bytes: deck }]);
  });

  it("sends a document's text and its pages", async () => {
    const renderer = fakeRenderer(() => fakePdf(1));
    const parts = await bytesToParts(
      "essay.docx",
      undefined,
      await textDocument(["My essay"]),
      DEFAULT_MATERIALIZE_LIMITS,
      { renderer },
    );
    expect(names(parts)).toEqual(["essay.docx", "essay.docx (pages)"]);
    expect(parts[0].text).toContain("My essay");
    expect(parts[1].verifyAgainst).toEqual(["essay.docx"]);
  });

  it("falls back to the text alone when rendering fails or is unavailable", async () => {
    for (const failure of [
      failed,
      { ok: false, code: "unavailable", message: "no soffice" } as const,
    ]) {
      const parts = await bytesToParts(
        "deck.pptx",
        undefined,
        await textDeck(["Findings"]),
        DEFAULT_MATERIALIZE_LIMITS,
        { renderer: fakeRenderer(() => failure) },
      );
      expect(names(parts)).toEqual(["deck.pptx"]);
    }
  });

  it("replaces pages over the native-file cap with a visible note", async () => {
    const limits: MaterializeLimits = {
      ...DEFAULT_MATERIALIZE_LIMITS,
      maxTokensPerNativeFile: 5000,
    };
    const parts = await bytesToParts(
      "deck.pptx",
      undefined,
      await textDeck(["Findings"]),
      limits,
      { renderer: fakeRenderer(() => fakePdf(40)) },
    );
    expect(names(parts)).toEqual(["deck.pptx", "deck.pptx (slides)"]);
    expect(parts[1].kind).toBe("text");
    expect(parts[1].text).toMatch(
      /^\[not sent: the rendered pages of deck\.pptx \(40 pages, about \d+ tokens\) are over the 5000-token cap; only the extracted text was sent\]$/,
    );
  });

  it("renders only a workbook with a chart, with the chart sheet alone visible", async () => {
    const renderer = fakeRenderer(() => fakePdf(1));
    const parts = await bytesToParts(
      "sales.xlsx",
      undefined,
      await chartWorkbook(20),
      DEFAULT_MATERIALIZE_LIMITS,
      { renderer },
    );
    const pages = parts.find(
      (part) => part.name === "sales.xlsx (chart pages)",
    );
    expect(pages).toMatchObject({ kind: "file", mimeType: "application/pdf" });
    // Every text part of the workbook can back a quote from the chart page.
    expect(pages?.verifyAgainst).toEqual(
      parts.filter((part) => part.kind === "text").map((part) => part.name),
    );
    expect(pages?.verifyAgainst).toEqual(
      expect.arrayContaining([
        "sales.xlsx › Data",
        "sales.xlsx › Dashboard",
        "sales.xlsx (charts)",
      ]),
    );
    expect(names(parts).at(-1)).toBe("sales.xlsx (chart pages)");
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0].extension).toBe("xlsx");
    const rendered = await JSZip.loadAsync(renderer.calls[0].bytes);
    const workbookXml = await rendered.file("xl/workbook.xml")?.async("string");
    expect(workbookXml?.match(/state="hidden"/g)).toHaveLength(2);
    expect(workbookXml).toMatch(/name="Dashboard"[^>]*r:id="rId3"\/>/);

    const plain = fakeRenderer(() => fakePdf(1));
    const plainParts = await bytesToParts(
      "plain.xlsx",
      undefined,
      plainWorkbook(),
      DEFAULT_MATERIALIZE_LIMITS,
      { renderer: plain },
    );
    expect(plain.calls).toHaveLength(0);
    expect(names(plainParts)).toEqual(["plain.xlsx › Data"]);
  });

  it("never renders xlsm, and keeps CSV parts when a chart render fails", async () => {
    const renderer = fakeRenderer(() => fakePdf(1));
    const workbook = await chartWorkbook(20);
    await bytesToParts(
      "macro.xlsm",
      undefined,
      workbook,
      DEFAULT_MATERIALIZE_LIMITS,
      { renderer },
    );
    expect(renderer.calls).toHaveLength(0);

    const parts = await bytesToParts(
      "sales.xlsx",
      undefined,
      workbook,
      DEFAULT_MATERIALIZE_LIMITS,
      { renderer: fakeRenderer(() => failed) },
    );
    expect(names(parts)).toContain("sales.xlsx › Data");
    expect(names(parts)).not.toContain("sales.xlsx (chart pages)");
  });

  it("renders nothing without a renderer", async () => {
    const parts = await bytesToParts(
      "deck.pptx",
      undefined,
      await textDeck(["Findings"]),
    );
    expect(names(parts)).toEqual(["deck.pptx"]);
  });
});

describe("materialize: rendered pages and the budget", () => {
  it("drops a file's rendered pages, not the file, when they don't fit", async () => {
    const deck = await textDeck(["Findings"]);
    const limits: MaterializeLimits = {
      ...DEFAULT_MATERIALIZE_LIMITS,
      tokenBudget: 3000,
    };
    const result = await materialize(
      {
        files: [
          {
            name: "deck.pptx",
            size: deck.length,
            load: () => Promise.resolve(deck),
          },
        ],
      },
      { renderer: fakeRenderer(() => fakePdf(10)) },
      limits,
    );
    if (result.ok === false) throw new Error(result.message);
    expect(names(result.parts)).toEqual(["deck.pptx", "deck.pptx (slides)"]);
    expect(result.parts[1].kind).toBe("text");
    expect(result.parts[1].text).toContain(
      "did not fit the submission budget; only the extracted text was sent",
    );
    expect(result.stats.filesSent).toBe(1);
  });

  it("sends the rendered pages when they fit", async () => {
    const deck = await textDeck(["Findings"]);
    const result = await materialize(
      {
        files: [
          {
            name: "deck.pptx",
            size: deck.length,
            load: () => Promise.resolve(deck),
          },
        ],
      },
      { renderer: fakeRenderer(() => fakePdf(1)) },
    );
    if (result.ok === false) throw new Error(result.message);
    expect(result.parts.map((part) => part.kind)).toEqual(["text", "file"]);
  });
});
