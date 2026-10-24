/**
 * Hyperlink targets embedded in uploaded documents.
 *
 * PDF link annotations, PPTX/DOCX hyperlink relationships and the like carry
 * their target outside the visible text, so a learner whose document reads
 * "GitHub Repository" never shows the grader the URL. These helpers turn the
 * raw targets into a bounded, sanitized list that extractors append to the
 * text the grader sees.
 */

/** Links reported for one document, across all pages/slides. */
export const MAX_DOCUMENT_LINKS = 100;

/** Longer targets are dropped rather than truncated: a cut URL is wrong evidence. */
export const MAX_LINK_URL_LENGTH = 2048;

/** Visible label kept next to a link. */
export const MAX_LINK_LABEL_LENGTH = 200;

/** Points of slack around a PDF link rectangle when matching its label. */
const PDF_LINK_RECT_SLACK = 2;

const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export interface DocumentLink {
  url: string;
  label?: string;
}

/**
 * The target as the grader should see it, or undefined when it is not an
 * external http(s)/mailto link (javascript:, file:, internal anchors,
 * relative paths) or is oversized or malformed.
 */
export function normalizeExternalLinkTarget(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_LINK_URL_LENGTH) return undefined;
  // Whitespace or control characters inside a target are never part of a
  // usable link and would let a crafted target break out of its line.
  if (/[\s\p{Cc}]/u.test(trimmed)) return undefined;

  // Relative paths, bookmarks and garbage do not parse as absolute URLs and
  // are not links the grader can use.
  const parsed = URL.parse(trimmed);
  if (!parsed) return undefined;
  if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) return undefined;
  if (parsed.protocol !== "mailto:" && !parsed.hostname) return undefined;
  return trimmed;
}

/** Collapse whitespace and cap length so a label stays on one short line. */
export function normalizeLinkLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const collapsed = raw.replaceAll(/[\s\p{Cc}]+/gu, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length > MAX_LINK_LABEL_LENGTH
    ? `${collapsed.slice(0, MAX_LINK_LABEL_LENGTH)}...`
    : collapsed;
}

/**
 * Accumulates links for one document under a shared budget. Duplicates are
 * dropped per location (page/slide), so a link repeated on several pages is
 * still reported where it appears, but never twice on the same page.
 */
export class DocumentLinkCollector {
  private total = 0;
  private dropped = 0;
  private readonly seen = new Map<string, Set<string>>();

  constructor(private readonly limit = MAX_DOCUMENT_LINKS) {}

  /** Whether the document-wide budget still has room. */
  get hasCapacity(): boolean {
    return this.total < this.limit;
  }

  /** Links refused because the budget was exhausted. */
  get droppedCount(): number {
    return this.dropped;
  }

  get count(): number {
    return this.total;
  }

  /**
   * Sanitize, dedupe and record one link for `location`. Returns the link
   * accepted, or undefined when it was invalid, a duplicate or over budget.
   */
  add(
    location: string,
    rawUrl: unknown,
    rawLabel?: unknown,
  ): DocumentLink | undefined {
    const url = normalizeExternalLinkTarget(rawUrl);
    if (!url) return undefined;

    let seenHere = this.seen.get(location);
    if (seenHere?.has(url)) return undefined;
    if (!this.hasCapacity) {
      this.dropped++;
      return undefined;
    }
    if (!seenHere) {
      seenHere = new Set();
      this.seen.set(location, seenHere);
    }
    seenHere.add(url);
    this.total++;

    const label = normalizeLinkLabel(rawLabel);
    return label && label !== url ? { url, label } : { url };
  }
}

/**
 * The text block appended after a page/slide's content, e.g.
 *
 *   --- LINKS (page 3) ---
 *   GitHub Repository → https://github.com/user/repo
 *
 * Empty string when there are no links.
 */
export function formatLinksBlock(
  locationLabel: string,
  links: DocumentLink[],
): string {
  if (links.length === 0) return "";
  const lines = links.map((link) =>
    link.label ? `${link.label} → ${link.url}` : link.url,
  );
  return `--- LINKS (${locationLabel}) ---\n${lines.join("\n")}`;
}

/** The parts of a pdfjs text item needed to place it on the page. */
export interface PositionedPdfText {
  str: string;
  transform: number[];
}

/**
 * The text drawn inside a PDF link rectangle ([x1, y1, x2, y2] in page
 * space), matched by each text item's origin. Undefined when the rectangle is
 * malformed or covers no text.
 */
export function textInsidePdfRect(
  items: readonly PositionedPdfText[],
  rect: unknown,
): string | undefined {
  if (!Array.isArray(rect) || rect.length < 4) return undefined;
  const [a, b, c, d] = rect.slice(0, 4).map(Number);
  if (![a, b, c, d].every((value) => Number.isFinite(value))) return undefined;
  const minX = Math.min(a, c) - PDF_LINK_RECT_SLACK;
  const maxX = Math.max(a, c) + PDF_LINK_RECT_SLACK;
  const minY = Math.min(b, d) - PDF_LINK_RECT_SLACK;
  const maxY = Math.max(b, d) + PDF_LINK_RECT_SLACK;

  const parts: string[] = [];
  for (const item of items) {
    if (typeof item?.str !== "string" || !Array.isArray(item.transform)) {
      continue;
    }
    const x = Number(item.transform[4]);
    const y = Number(item.transform[5]);
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      const text = item.str.trim();
      if (text) parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Annotations inspected per PDF page when looking for links. A crafted page
 * can declare thousands; real pages carry a handful.
 */
export const MAX_ANNOTATIONS_SCANNED_PER_PAGE = 500;

/**
 * External links among one page's pdfjs annotations, each labelled with the
 * text drawn inside its rectangle. Anything that is not a well-formed Link
 * annotation with a URL target is ignored.
 */
export function collectPdfAnnotationLinks(
  annotations: unknown,
  textItems: readonly PositionedPdfText[],
  collector: DocumentLinkCollector,
  location: string,
): DocumentLink[] {
  if (!Array.isArray(annotations)) return [];
  const links: DocumentLink[] = [];
  for (const candidate of annotations.slice(
    0,
    MAX_ANNOTATIONS_SCANNED_PER_PAGE,
  )) {
    if (!collector.hasCapacity) break;
    if (!candidate || typeof candidate !== "object") continue;
    const annotation = candidate as {
      subtype?: unknown;
      url?: unknown;
      rect?: unknown;
    };
    if (annotation.subtype !== "Link") continue;
    // pdfjs only sets `url` for targets it considers safe (`unsafeUrl` holds
    // the raw value); the collector re-checks the protocol regardless.
    if (typeof annotation.url !== "string") continue;
    const link = collector.add(
      location,
      annotation.url,
      textInsidePdfRect(textItems, annotation.rect),
    );
    if (link) links.push(link);
  }
  return links;
}
