import JSZip from "jszip";
import {
  OFFICE_ZIP_LIMITS,
  openOfficeZip,
  parseRelationships,
} from "./zip-read";

/**
 * A copy of a workbook prepared so LibreOffice prints only what the model
 * can't get from the CSV parts: sheets with charts or images, each scaled
 * onto one landscape page. Sheets without a drawing are hidden. Regex over
 * the XML, as elsewhere: only a few known elements are touched.
 */

const DRAWING = /<(?:\w+:)?drawing\b/;

/** Worksheet children that come after pageSetup, in schema order. */
const AFTER_PAGE_SETUP = [
  "headerFooter",
  "rowBreaks",
  "colBreaks",
  "customProperties",
  "cellWatches",
  "ignoredErrors",
  "smartTags",
  "drawing",
  "legacyDrawing",
  "legacyDrawingHF",
  "drawingHF",
  "picture",
  "oleObjects",
  "controls",
  "webPublishItems",
  "tableParts",
  "extLst",
];

export function sheetHasDrawing(sheetXml: string): boolean {
  return DRAWING.test(sheetXml);
}

/** Removes `<tag .../>` and `<tag ...>...</tag>` for a prefixed tag. */
function removeElement(xml: string, tag: string): string {
  return xml
    .replaceAll(new RegExp(`<${tag}\\b[^>]*/>`, "g"), "")
    .replaceAll(new RegExp(`<${tag}\\b[^>]*>[\\S\\s]*?</${tag}>`, "g"), "");
}

/**
 * Fit one worksheet onto a single landscape page: pageSetUpPr fitToPage in
 * sheetPr, and a pageSetup after pageMargins replacing any existing one.
 * Manual page breaks are dropped so they can't split the page.
 */
export function fitSheetToOnePage(sheetXml: string): string {
  const root = /<((?:\w+:)?)worksheet\b[^>]*>/.exec(sheetXml);
  if (!root) return sheetXml;
  const prefix = root[1];
  const tag = (name: string) => `${prefix}${name}`;
  const fit = `<${tag("pageSetUpPr")} fitToPage="1"/>`;
  let xml = sheetXml;

  const selfClosingPr = new RegExp(`<${tag("sheetPr")}\\b([^>]*?)\\s*/>`);
  const openPr = new RegExp(
    `<${tag("sheetPr")}\\b([^>]*)>([\\S\\s]*?)</${tag("sheetPr")}>`,
  );
  if (selfClosingPr.test(xml)) {
    xml = xml.replace(
      selfClosingPr,
      (_match, attributes: string) =>
        `<${tag("sheetPr")}${attributes}>${fit}</${tag("sheetPr")}>`,
    );
  } else if (openPr.test(xml)) {
    xml = xml.replace(openPr, (_match, attributes: string, body: string) => {
      // pageSetUpPr is the last child of sheetPr.
      const rest = removeElement(body, tag("pageSetUpPr"));
      return `<${tag("sheetPr")}${attributes}>${rest}${fit}</${tag("sheetPr")}>`;
    });
  } else {
    // sheetPr is the first child of worksheet.
    xml = xml.replace(
      root[0],
      `${root[0]}<${tag("sheetPr")}>${fit}</${tag("sheetPr")}>`,
    );
  }

  xml = removeElement(xml, tag("pageSetup"));
  xml = removeElement(xml, tag("rowBreaks"));
  xml = removeElement(xml, tag("colBreaks"));
  const pageSetup = `<${tag("pageSetup")} orientation="landscape" fitToWidth="1" fitToHeight="1"/>`;

  const margins = new RegExp(
    `<${tag("pageMargins")}\\b[^>]*/>|<${tag("pageMargins")}\\b[^>]*>[\\S\\s]*?</${tag("pageMargins")}>`,
  ).exec(xml);
  if (margins) {
    const end = margins.index + margins[0].length;
    return `${xml.slice(0, end)}${pageSetup}${xml.slice(end)}`;
  }
  // No pageMargins: before the first element that follows pageSetup.
  let insertAt = -1;
  for (const name of AFTER_PAGE_SETUP) {
    const found = new RegExp(`<${tag(name)}\\b`).exec(xml);
    if (found && (insertAt === -1 || found.index < insertAt)) {
      insertAt = found.index;
    }
  }
  if (insertAt === -1) {
    insertAt = xml.lastIndexOf(`</${tag("worksheet")}>`);
    if (insertAt === -1) return xml;
  }
  return `${xml.slice(0, insertAt)}${pageSetup}${xml.slice(insertAt)}`;
}

/**
 * Workbook XML with every sheet hidden except those whose relationship id
 * is in `visibleIds`, the active tab moved to the first visible sheet, and
 * print areas removed so they can't crop a chart.
 */
export function showOnlySheets(
  workbookXml: string,
  visibleIds: Set<string>,
): string {
  let firstVisible = -1;
  let index = 0;
  let xml = workbookXml.replaceAll(
    /<((?:\w+:)?)sheet\b([^>]*?)(\s*\/?)>/g,
    (_match, prefix: string, attributes: string, close: string) => {
      const id = /\br:id="([^"]*)"/.exec(attributes)?.[1] ?? "";
      const visible = visibleIds.has(id);
      if (visible && firstVisible === -1) firstVisible = index;
      index += 1;
      const rest = attributes.replaceAll(/\s+state="[^"]*"/g, "");
      return `<${prefix}sheet${rest}${visible ? "" : ' state="hidden"'}${close}>`;
    },
  );
  xml = xml.replaceAll(
    /<((?:\w+:)?)definedName\b[^>]*\bname="_xlnm\.(?:Print_Area|Print_Titles)"[^>]*>[\S\s]*?<\/\1definedName>/g,
    "",
  );
  const hasView = /<(?:\w+:)?workbookView\b/.test(xml);
  if (firstVisible >= 0 && !hasView) {
    // No view means active tab 0, which LibreOffice shows (and prints) even
    // when hidden. bookViews goes right before sheets.
    const sheets = /<((?:\w+:)?)sheets\b/.exec(xml);
    if (sheets) {
      const prefix = sheets[1];
      xml = `${xml.slice(0, sheets.index)}<${prefix}bookViews><${prefix}workbookView activeTab="${firstVisible}"/></${prefix}bookViews>${xml.slice(sheets.index)}`;
    }
  } else if (firstVisible >= 0) {
    xml = xml.replaceAll(
      /<((?:\w+:)?)workbookView\b([^>]*?)(\s*\/?)>/g,
      (_match, prefix: string, attributes: string, close: string) => {
        const rest = attributes
          .replaceAll(/\s+activeTab="[^"]*"/g, "")
          .replaceAll(/\s+firstSheet="[^"]*"/g, "");
        return `<${prefix}workbookView${rest} activeTab="${firstVisible}"${close}>`;
      },
    );
  }
  return xml;
}

export interface ChartWorkbook {
  buffer: Buffer;
  /** Names of the sheets left visible, in workbook order. */
  sheets: string[];
}

/**
 * The prepared copy, or undefined when no sheet has a chart or image (or
 * the workbook parts can't be read within the zip limits).
 */
export async function chartSheetsWorkbook(
  buffer: Buffer,
): Promise<ChartWorkbook | undefined> {
  const office = await openOfficeZip(buffer);
  const total = office.paths.reduce(
    (sum, entry) => sum + (office.size(entry) ?? 0),
    0,
  );
  if (total > OFFICE_ZIP_LIMITS.maxTotalBytes) return undefined;
  const workbookXml = await office.text("xl/workbook.xml");
  const relsXml = await office.text("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return undefined;
  const rels = parseRelationships(relsXml, "xl");

  const visibleIds = new Set<string>();
  const visibleNames: string[] = [];
  const rewritten = new Map<string, string>();
  for (const match of workbookXml.matchAll(
    /<(?:\w+:)?sheet\b([^>]*?)\s*\/?>/g,
  )) {
    const id = /\br:id="([^"]*)"/.exec(match[1])?.[1];
    const name = /\bname="([^"]*)"/.exec(match[1])?.[1] ?? "";
    const relationship = id ? rels.get(id) : undefined;
    if (!id || !relationship) continue;
    const sheetXml = await office.text(relationship.target);
    if (!sheetXml || !sheetHasDrawing(sheetXml)) continue;
    visibleIds.add(id);
    visibleNames.push(name);
    // Chart sheets already print as one chart per page.
    if (/chartsheet$/i.test(relationship.type)) continue;
    rewritten.set(relationship.target, fitSheetToOnePage(sheetXml));
  }
  if (visibleIds.size === 0) return undefined;

  const zip = await JSZip.loadAsync(buffer);
  zip.file("xl/workbook.xml", showOnlySheets(workbookXml, visibleIds));
  for (const [target, xml] of rewritten) zip.file(target, xml);
  const output = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return { buffer: output, sheets: visibleNames };
}
