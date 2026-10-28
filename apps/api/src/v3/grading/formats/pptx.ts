import type { Part } from "../contracts";
import {
  PPTX_MAX_IMAGES,
  PPTX_MAX_SLIDES,
  PPTX_MIN_IMAGE_BYTES,
} from "../limits";
import { describeChartXml } from "./xlsx-charts";
import {
  decodeXmlEntities,
  type OfficeZip,
  openOfficeZip,
  parseRelationships,
} from "./zip-read";

/**
 * PowerPoint → one text part plus image parts. Per slide, in presentation
 * order: number, title, body text, tables (cells joined with " | "), charts,
 * speaker notes, and a marker for each embedded image saying whether it was
 * sent. Images go as image parts, at most PPTX_MAX_IMAGES per deck, skipping
 * ones under PPTX_MIN_IMAGE_BYTES (icons, bullets). Regex over the XML, as
 * for xlsx charts: slide XML is regular enough.
 */

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Placeholders that hold furniture, not content. */
const FURNITURE_PLACEHOLDERS = new Set([
  "sldNum",
  "dt",
  "ftr",
  "hdr",
  "sldImg",
]);
const TITLE_PLACEHOLDERS = new Set(["title", "ctrTitle"]);

const SHAPE =
  /<p:sp(?:\s[^>]*)?>([\S\s]*?)<\/p:sp>|<p:graphicFrame(?:\s[^>]*)?>([\S\s]*?)<\/p:graphicFrame>/g;

function folderOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function fileOf(path: string): string {
  return path.split("/").pop() ?? path;
}

function relsPathFor(partPath: string): string {
  return `${folderOf(partPath)}/_rels/${fileOf(partPath)}.rels`;
}

function paragraphText(paragraph: string): string {
  const pieces: string[] = [];
  for (const match of paragraph.matchAll(/<a:t>([^<]*)<\/a:t>|<a:br\s*\/>/g)) {
    pieces.push(match[1] === undefined ? "\n" : decodeXmlEntities(match[1]));
  }
  return pieces.join("");
}

/** Paragraphs as lines; empty paragraphs dropped. */
function paragraphs(fragment: string): string[] {
  return [...fragment.matchAll(/<a:p(?:\s[^>]*)?>([\S\s]*?)<\/a:p>/g)]
    .map((match) => paragraphText(match[1]).trim())
    .filter((line) => line.length > 0);
}

function tableText(fragment: string): string {
  const rows = [...fragment.matchAll(/<a:tr(?:\s[^>]*)?>([\S\s]*?)<\/a:tr>/g)];
  return rows
    .map((row) =>
      [...row[1].matchAll(/<a:tc(?:\s[^>]*)?>([\S\s]*?)<\/a:tc>|<a:tc\s*\/>/g)]
        .map((cell) => paragraphs(cell[1] ?? "").join(" "))
        .join(" | "),
    )
    .join("\n");
}

function placeholderType(shapeXml: string): string | undefined {
  const ph = /<p:ph\b([^>]*)\/?>/.exec(shapeXml);
  if (!ph) return undefined;
  return /\btype="([^"]*)"/.exec(ph[1])?.[1] ?? "body";
}

interface ShapeText {
  title: string[];
  body: string[];
  chartIds: string[];
}

function shapeTexts(xml: string): ShapeText {
  const result: ShapeText = { title: [], body: [], chartIds: [] };
  for (const match of xml.matchAll(SHAPE)) {
    if (match[1] !== undefined) {
      const type = placeholderType(match[1]);
      if (type && FURNITURE_PLACEHOLDERS.has(type)) continue;
      const lines = paragraphs(match[1]);
      if (type && TITLE_PLACEHOLDERS.has(type)) result.title.push(...lines);
      else result.body.push(...lines);
      continue;
    }
    const frame = match[2] ?? "";
    if (frame.includes("<a:tbl")) {
      result.body.push(tableText(frame));
    }
    const chartId = /<c:chart\b[^>]*\br:id="([^"]*)"/.exec(frame)?.[1];
    if (chartId) result.chartIds.push(chartId);
  }
  return result;
}

function slideFileNumber(path: string): number {
  return Number(/slide(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

async function slideOrder(zip: OfficeZip): Promise<string[]> {
  const presentation = await zip.text("ppt/presentation.xml");
  const rels = await zip.text("ppt/_rels/presentation.xml.rels");
  if (presentation && rels) {
    const targets = parseRelationships(rels, "ppt");
    const ordered = [...presentation.matchAll(/<p:sldId\b([^>]*)\/?>/g)]
      .map((match) => /\br:id="([^"]*)"/.exec(match[1])?.[1])
      .map((id) => (id ? targets.get(id)?.target : undefined))
      .filter((path): path is string => !!path && zip.paths.includes(path));
    if (ordered.length > 0) return ordered;
  }
  return zip.paths
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideFileNumber(a) - slideFileNumber(b));
}

interface ImageBudget {
  sent: Map<string, string>;
  parts: Part[];
}

async function imageMarker(
  zip: OfficeZip,
  deckName: string,
  slideNumber: number,
  mediaPath: string,
  budget: ImageBudget,
): Promise<string> {
  const file = fileOf(mediaPath);
  const already = budget.sent.get(mediaPath);
  if (already) return `[image ${file}: sent as part "${already}"]`;
  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = IMAGE_TYPES[extension];
  if (!mimeType)
    return `[image ${file}: ${extension || "unknown"} format, not sent]`;
  const size = zip.size(mediaPath) ?? 0;
  if (size < PPTX_MIN_IMAGE_BYTES) {
    return `[image ${file}: under ${PPTX_MIN_IMAGE_BYTES / 1024} KB, not sent]`;
  }
  if (budget.parts.length >= PPTX_MAX_IMAGES) {
    return `[image ${file}: not sent, over the ${PPTX_MAX_IMAGES}-image cap]`;
  }
  const bytes = await zip.read(mediaPath);
  if (!bytes) return `[image ${file}: too large to read, not sent]`;
  const partName = `${deckName} › slide ${slideNumber} › ${file}`;
  budget.parts.push({
    name: partName,
    kind: "image",
    mimeType,
    base64: bytes.toString("base64"),
  });
  budget.sent.set(mediaPath, partName);
  return `[image ${file}: sent as part "${partName}"]`;
}

async function notesText(zip: OfficeZip, notesPath: string): Promise<string[]> {
  const xml = await zip.text(notesPath);
  if (!xml) return [];
  const texts = shapeTexts(xml);
  return [...texts.title, ...texts.body];
}

/** Throws on a file that is not a readable zip; the caller reports it. */
export async function pptxToParts(
  name: string,
  buffer: Buffer,
): Promise<Part[]> {
  const zip = await openOfficeZip(buffer);
  const allSlides = await slideOrder(zip);
  if (allSlides.length === 0) throw new Error("no slides");
  const slides = allSlides.slice(0, PPTX_MAX_SLIDES);
  const budget: ImageBudget = { sent: new Map(), parts: [] };
  const sections: string[] = [];

  for (const [index, slidePath] of slides.entries()) {
    const number = index + 1;
    const xml = await zip.text(slidePath);
    if (xml === undefined) {
      sections.push(`## Slide ${number}\n(too large to read)`);
      continue;
    }
    const hidden = /<p:sld\b[^>]*\bshow="(0|false)"/.test(xml)
      ? " (hidden slide)"
      : "";
    const texts = shapeTexts(xml);
    const relsXml = await zip.text(relsPathFor(slidePath));
    const rels = relsXml
      ? parseRelationships(relsXml, folderOf(slidePath))
      : new Map<string, { target: string; type: string }>();

    const lines: string[] = [...texts.body];
    for (const chartId of texts.chartIds) {
      const chartPath = rels.get(chartId)?.target;
      const chartXml = chartPath ? await zip.text(chartPath) : undefined;
      lines.push(
        chartXml
          ? `Chart:\n${describeChartXml(chartXml)}`
          : "[chart: could not be read]",
      );
    }

    // Images in the order the slide uses them, then any other image links.
    const embedded = [...xml.matchAll(/\br:embed="([^"]*)"/g)].map(
      (match) => match[1],
    );
    const imageIds = [
      ...new Set([
        ...embedded,
        ...[...rels.entries()]
          .filter(([, relationship]) => /image$/i.test(relationship.type))
          .map(([id]) => id),
      ]),
    ].filter((id) => /image$/i.test(rels.get(id)?.type ?? ""));
    for (const id of imageIds) {
      const target = rels.get(id)?.target;
      if (target)
        lines.push(await imageMarker(zip, name, number, target, budget));
    }

    const notesPath = [...rels.values()].find((relationship) =>
      /notesslide$/i.test(relationship.type),
    )?.target;
    const notes = notesPath ? await notesText(zip, notesPath) : [];
    if (notes.length > 0) lines.push(`Speaker notes:\n${notes.join("\n")}`);

    const title = texts.title.join(" ");
    sections.push(
      `## Slide ${number}${title ? `: ${title}` : ""}${hidden}\n${lines.length > 0 ? lines.join("\n") : "(no text)"}`,
    );
  }

  const cut =
    allSlides.length > slides.length
      ? `\n\n[${allSlides.length - slides.length} more slide(s) not read: over the ${PPTX_MAX_SLIDES}-slide limit]`
      : "";
  const header = `PowerPoint deck ${name}, ${allSlides.length} slide(s). Text per slide in order; images are sent as separate parts where noted.`;
  return [
    { name, kind: "text", text: `${header}\n\n${sections.join("\n\n")}${cut}` },
    ...budget.parts,
  ];
}
