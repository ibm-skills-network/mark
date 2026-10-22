import { readBoundedZip } from "./bounded-zip";
import { parseStringPromise, processors } from "xml2js";
import sharp from "sharp";
import { posix } from "node:path";
import type { ParserDocument, ParserLimits } from "./parser.types";

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
type Xml = Record<string, unknown>;
function object(value: unknown): Xml { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Xml : {}; }
function attribute(value: Xml, name: string): string { const result = object(value.$)[name]; return typeof result === "string" ? result : ""; }
type ZipEntries = Map<string, Buffer>;

/** Validate central-directory sizes before inflating, then bound actual streamed
 * bytes. No archive entry ever becomes a filesystem path or executes code. */
async function readOfficeZip(
  bytes: Buffer,
  limits: ParserLimits,
): Promise<ZipEntries> {
  if (bytes.length > limits.inputBytes) fail("input_limit");
  const zip = await readBoundedZip(bytes, {
    expandedBytes: limits.expandedBytes,
    files: Math.min(4000, limits.pages * 20),
    nesting: 12,
  });
  const result: ZipEntries = new Map(
    zip.entries.map((entry) => [entry.path, entry.bytes]),
  );
  return result;
}
async function xml(bytes: Buffer | undefined): Promise<Xml> {
  if (!bytes) fail("corrupt_input");
  const text = bytes.toString("utf8");
  if (/<!doctype|<!entity/i.test(text)) fail("corrupt_input");
  return parseStringPromise(text, {
    explicitArray: true,
    tagNameProcessors: [processors.stripPrefix],
    attrNameProcessors: [processors.stripPrefix],
  }) as Promise<Xml>;
}
function array(value: unknown): Xml[] {
  return Array.isArray(value) ? (value as Xml[]) : [];
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((value) => text(value)).join("");
  if (value && typeof value === "object") return text((value as Xml)._);
  return "";
}
function descendants(node: unknown, name: string): unknown[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node))
    return node.flatMap((child) => descendants(child, name));
  return Object.entries(object(node)).flatMap(([key, value]) =>
    key === name
      ? Array.isArray(value)
        ? (value as unknown[])
        : [value]
      : key === "$"
        ? []
        : descendants(value, name),
  );
}
function expandedBytes(entries: ZipEntries) {
  return [...entries.values()].reduce((sum, bytes) => sum + bytes.length, 0);
}
function enforceOutput(
  result: ParserDocument,
  limits: ParserLimits,
): ParserDocument {
  if (Buffer.byteLength(JSON.stringify(result)) > limits.outputBytes)
    fail("output_limit");
  result.empty = result.blocks.length === 0 && result.omissions.length === 0;
  return result;
}
function extension(filename: string) {
  return posix.extname(filename).toLowerCase();
}

export async function extractSpreadsheet(
  bytes: Buffer,
  limits: ParserLimits,
  filename: string,
): Promise<ParserDocument> {
  if (extension(filename) !== ".xlsx") fail("unsupported_format");
  const entries = await readOfficeZip(bytes, limits);
  const workbook = await xml(entries.get("xl/workbook.xml"));
  const relationships = await xml(entries.get("xl/_rels/workbook.xml.rels"));
  if (!workbook.workbook || !relationships.Relationships) fail("corrupt_input");
  const shared = entries.has("xl/sharedStrings.xml")
    ? await xml(entries.get("xl/sharedStrings.xml"))
    : undefined;
  const strings = shared
    ? array(object(shared.sst).si).map((item) =>
        descendants(item, "t").map((value) => text(value)).join(""),
      )
    : [];
  const relationMap = new Map<string, string>();
  for (const relation of array(object(relationships.Relationships).Relationship)) {
    if (attribute(relation, "TargetMode") === "External") continue;
    relationMap.set(attribute(relation, "Id"), attribute(relation, "Target"));
  }
  const result: ParserDocument = {
    blocks: [],
    omissions: [],
    expandedBytes: expandedBytes(entries),
  };
  const sheets = array(object(array(object(workbook.workbook).sheets)[0]).sheet);
  if (sheets.length > limits.pages) fail("expansion_limit");
  let cells = 0;
  for (const sheet of sheets) {
    const name = attribute(sheet, "name");
    const target = relationMap.get(attribute(sheet, "id"));
    if (
      !name ||
      !target ||
      target.includes("\\") ||
      target.split("/").includes("..")
    )
      fail("corrupt_input");
    const sheetPath = target.startsWith("/")
      ? target.slice(1)
      : posix.join("xl", target);
    if (!sheetPath.startsWith("xl/")) fail("corrupt_input");
    const data = await xml(entries.get(sheetPath));
    if (!data.worksheet) fail("corrupt_input");
    let styledCells = false;
    for (const cell of descendants(data, "c") as Xml[]) {
      if (++cells > Math.min(200_000, limits.pages * 1000))
        fail("expansion_limit");
      const address = attribute(cell, "r");
      styledCells ||= attribute(cell, "s") !== "";
      if (
        !address ||
        !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address)
      )
        fail("corrupt_input");
      let value = text(cell.v);
      if (attribute(cell, "t") === "s") {
        if (!/^\d+$/.test(value) || strings[Number(value)] === undefined)
          fail("corrupt_input");
        value = strings[Number(value)];
      } else if (attribute(cell, "t") === "inlineStr")
        value = descendants(cell.is, "t").map((value) => text(value)).join("");
      const formula = text(cell.f);
      if (value === "" && formula === "") continue;
      result.blocks.push({
        kind: "table",
        text: JSON.stringify({
          value,
          ...(formula ? { formula, calculation: "cached-not-recomputed" } : {}),
        }),
        location: { sheet: name, cell: address },
      });
      if (formula && !cell.v)
        result.omissions.push({
          code: "missing_content",
          location: { sheet: name, cell: address },
          detail: "Formula has no cached result; formulas are not executed.",
        });
    }
    if (styledCells)
      result.omissions.push({
        code: "unsupported_feature",
        location: { sheet: name },
        detail:
          "Cell values are preserved; date, number and conditional display formatting is not rendered.",
      });
    if (
      descendants(data, "drawing").length > 0 ||
      descendants(data, "legacyDrawing").length > 0
    )
      result.omissions.push({
        code: "missing_visual_evidence",
        location: { sheet: name },
        detail: "Spreadsheet drawing rendering is not extracted.",
      });
  }
  // Namespace prefixes are deliberately ignored: chart structure remains
  // identifiable even when generated by a different office application.
  for (const [name, content] of entries)
    if (/^xl\/charts\/chart[^/]*\.xml$/.test(name)) {
      const chart = await xml(content);
      result.blocks.push({
        kind: "chart",
        text: JSON.stringify(chart),
        location: { archivePath: name },
      });
      result.omissions.push({
        code: "missing_visual_evidence",
        location: { archivePath: name },
        detail:
          "Chart XML is retained; rendered chart appearance is not extracted.",
      });
    }
  if (
    [...entries.keys()].some((name) =>
      /vbaproject|externallinks|embeddings/i.test(name),
    )
  )
    result.omissions.push({
      code: "unsupported_feature",
      detail:
        "Embedded objects, macros and external links are not executed or fetched.",
    });
  return enforceOutput(result, limits);
}

export async function extractDocument(
  bytes: Buffer,
  limits: ParserLimits,
  filename: string,
): Promise<ParserDocument> {
  if (extension(filename) !== ".docx") fail("unsupported_format");
  const entries = await readOfficeZip(bytes, limits);
  const result: ParserDocument = {
    blocks: [],
    omissions: [],
    expandedBytes: expandedBytes(entries),
  };
  if (!entries.has("word/document.xml")) fail("corrupt_input");
  for (const [name, content] of entries) {
    if (
      !/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(
        name,
      )
    )
      continue;
    const data = await xml(content);
    if (name === "word/document.xml" && !data.document) fail("corrupt_input");
    if (
      descendants(data, "tbl").length > 0 ||
      descendants(data, "hyperlink").length > 0
    )
      result.omissions.push({
        code: "unsupported_feature",
        location: { archivePath: name },
        detail:
          "Table layout and hyperlink targets are not represented by paragraph text.",
      });
    const paragraphs = descendants(data, "p");
    if (paragraphs.length > limits.pages * 1000) fail("expansion_limit");
    for (const [index, paragraph] of paragraphs.entries()) {
      const value = descendants(paragraph, "t").map((value) => text(value)).join("");
      if (value)
        result.blocks.push({
          kind: "text",
          text: value,
          location: { archivePath: name, section: `paragraph:${index + 1}` },
        });
    }
    if (
      ["drawing", "pict", "oMath", "object", "altChunk"].some(
        (tag) => descendants(data, tag).length,
      )
    )
      result.omissions.push({
        code: "missing_visual_evidence",
        location: { archivePath: name },
        detail:
          "Drawings, equations or embedded document content are not rendered.",
      });
    if (descendants(data, "del").length > 0 || descendants(data, "ins").length > 0)
      result.omissions.push({
        code: "unsupported_feature",
        location: { archivePath: name },
        detail:
          "Tracked changes are present; revision semantics require review.",
      });
  }
  if (
    [...entries.keys()].some((name) => /^word\/(media|embeddings)\//.test(name))
  )
    result.omissions.push({
      code: "missing_visual_evidence",
      detail:
        "Original document retains embedded media; extracted text omits visual content.",
    });
  return enforceOutput(result, limits);
}

export async function extractPresentation(
  bytes: Buffer,
  limits: ParserLimits,
  filename: string,
): Promise<ParserDocument> {
  if (extension(filename) !== ".pptx") fail("unsupported_format");
  const entries = await readOfficeZip(bytes, limits);
  const presentation = await xml(entries.get("ppt/presentation.xml"));
  const relationships = await xml(
    entries.get("ppt/_rels/presentation.xml.rels"),
  );
  if (!presentation.presentation || !relationships.Relationships)
    fail("corrupt_input");
  const references = new Map<string, string>();
  for (const relationship of array(object(relationships.Relationships).Relationship))
    if (attribute(relationship, "TargetMode") !== "External")
      references.set(attribute(relationship, "Id"), attribute(relationship, "Target"));
  const slides = array(object(array(object(presentation.presentation).sldIdLst)[0]).sldId);
  if (slides.length > limits.pages) fail("expansion_limit");
  const result: ParserDocument = {
    blocks: [],
    omissions: [],
    expandedBytes: expandedBytes(entries),
  };
  for (const [index, slide] of slides.entries()) {
    const target = references.get(attribute(slide, "id"));
    if (!target || target.includes("\\") || target.split("/").includes(".."))
      fail("corrupt_input");
    const filename = target.startsWith("/")
      ? target.slice(1)
      : posix.join("ppt", target);
    if (!filename.startsWith("ppt/slides/")) fail("corrupt_input");
    const data = await xml(entries.get(filename));
    const content = descendants(data, "p")
      .map((p) => descendants(p, "t").map((value) => text(value)).join(""))
      .join("\n");
    if (content)
      result.blocks.push({
        kind: "text",
        text: content,
        location: { slide: index + 1 },
      });
    // Even a text-only slide's position/layout can be part of the rubric.
    result.omissions.push({
      code: "missing_visual_evidence",
      location: { slide: index + 1 },
      detail:
        "Slide layout, graphics, animation and speaker delivery are not rendered.",
    });
  }
  for (const [name, bytes] of entries)
    if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)) {
      const data = await xml(bytes);
      const content = descendants(data, "t").map((value) => text(value)).join("\n");
      if (content)
        result.blocks.push({
          kind: "text",
          text: content,
          location: { archivePath: name, section: "speaker-notes" },
        });
    }
  return enforceOutput(result, limits);
}

export async function extractImage(
  bytes: Buffer,
  limits: ParserLimits,
  filename: string,
): Promise<ParserDocument> {
  if (
    ![".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff"].includes(
      extension(filename),
    )
  )
    fail("unsupported_format");
  if (bytes.length > limits.inputBytes) fail("input_limit");
  const pixelLimit = Math.max(1, Math.floor(limits.expandedBytes / 4));
  const metadata = await sharp(bytes, {
    limitInputPixels: pixelLimit,
    failOn: "warning",
  }).metadata();
  if (!metadata.width || !metadata.height) fail("corrupt_input");
  if (metadata.width * metadata.height * (metadata.pages ?? 1) > pixelLimit)
    fail("expansion_limit");
  // Decode inside isolation, proving the original is actually readable. Retain
  // the immutable original reference for downstream visual evidence selection.
  await sharp(bytes, {
    limitInputPixels: pixelLimit,
    failOn: "warning",
    animated: true,
  })
    .raw()
    .toBuffer();
  return enforceOutput(
    {
      blocks: [
        {
          kind: "image",
          resourceRef: "original",
          location: { section: "original-image" },
        },
      ],
      omissions: [],
      expandedBytes:
        metadata.width * metadata.height * (metadata.pages ?? 1) * 4,
    },
    limits,
  );
}

export async function extractMedia(
  bytes: Buffer,
  limits: ParserLimits,
  format: string,
  filename: string,
): Promise<ParserDocument> {
  switch (format) {
    case "spreadsheet": {
      return extractSpreadsheet(bytes, limits, filename);
    }
    case "document": {
      return extractDocument(bytes, limits, filename);
    }
    case "presentation": {
      return extractPresentation(bytes, limits, filename);
    }
    case "image": {
      return extractImage(bytes, limits, filename);
    }
    default: {
      return fail("unsupported_format");
    }
  }
}
