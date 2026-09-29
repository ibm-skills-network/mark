/**
 * Structure-preserving PDF extractor using PDF.js
 *
 * This replaces simple text extraction with block-level structure preservation
 * for evidence-based grading.
 */

import { Injectable, Logger } from "@nestjs/common";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as crypto from "node:crypto";
import { createCanvas } from "canvas";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PDFOperatorList,
  TextContent,
  TextItem as PdfJsTextItem,
} from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import { MAX_EVIDENCE_BLOCKS_PER_SUBMISSION } from "../../llm/features/grading/constants";
import { OversizedSubmissionError } from "../../llm/features/grading/errors/oversized-submission.error";
import {
  CanonicalSubmission,
  ContentBlock,
  StructuredPage,
  BlockType,
  DocumentSection,
  ExtractionMetadata,
} from "./structured-content.models";

type NormalizedTextItem = Pick<
  PdfJsTextItem,
  "str" | "dir" | "fontName" | "hasEOL"
> & {
  transform: number[];
  width: number;
  height: number;
};

interface PdfImageData {
  data: Uint8ClampedArray | Uint8Array | number[];
  width: number;
  height: number;
  kind?: number;
}

/**
 * pdfjs publishes decoded images either on the page-local object store or, for
 * images it caches across pages, on the document-wide one. Both expose the same
 * two-form getter: synchronous once the object has arrived, callback-based
 * before that.
 */
interface PdfObjectStore {
  has(objectId: string): boolean;
  get(objectId: string): unknown;
  get(objectId: string, callback: (value: unknown) => void): null;
}

/** One image-painting site found in a page's operator list. */
interface PdfImageReference {
  /** pdfjs operator that painted it, for diagnostics. */
  operator: string;
  /** Object id to resolve from the page/document object store, when the operator uses one. */
  objectId?: string;
  /** Image data carried directly in the operator arguments (inline images). */
  inline?: unknown;
}

/** Remaining document-wide image allowance, shared across pages. */
interface PdfImageBudget {
  remaining: number;
}

/**
 * Ceiling on the pixels a single embedded image may expand to. Conversion
 * materializes width x height x 4 bytes of RGBA before encoding, so 12M pixels
 * is ~48 MB — comfortably above a 300 dpi full-page scan (~8.4M pixels) and far
 * below anything that would threaten the pod.
 */
export const MAX_IMAGE_PIXELS = 12_000_000;

/** Ceiling on images extracted from one page. */
export const MAX_IMAGES_PER_PAGE = 20;

/** Ceiling on images extracted from one document, across all pages. */
export const MAX_IMAGES_PER_DOCUMENT = 60;

/**
 * How long to wait for the pdfjs worker to publish a page's image objects.
 * They arrive shortly after getOperatorList() resolves, so this is a safety
 * net rather than a normal cost. Tunable via PDF_IMAGE_RESOLVE_TIMEOUT_MS.
 */
const DEFAULT_IMAGE_RESOLVE_TIMEOUT_MS = 10_000;

@Injectable()
export class PdfStructureExtractorService {
  private readonly logger = new Logger(PdfStructureExtractorService.name);

  /**
   * Extract structured content from PDF buffer
   * This is the main entry point
   */
  async extractStructuredContent(
    buffer: Buffer,
    submissionId: string,
  ): Promise<{
    submission: CanonicalSubmission;
    metadata: ExtractionMetadata;
  }> {
    const startTime = Date.now();
    const warnings: string[] = [];

    // Forensic identifiers — computed once from the raw buffer (no PII risk;
    // submissionId is opaque, hash + size are non-sensitive, magic bytes are
    // the first 8 bytes of the file used to discriminate PDF/XLSX/junk).
    // Declared before the try so the catch branch can include them too.
    const byteSize = buffer.byteLength;
    const sha256Full = crypto.createHash("sha256").update(buffer).digest("hex");
    const sha256Short = sha256Full.slice(0, 16);
    const magicBytesHex = buffer.subarray(0, 8).toString("hex");

    this.logger.log(
      `extractStructuredContent entry: submissionId=${submissionId} ` +
        `byteSize=${byteSize} sha256=${sha256Short} magicBytes=${magicBytesHex}`,
    );

    try {
      const uint8Array = new Uint8Array(buffer);
      const loadingTask = pdfjs.getDocument({
        data: uint8Array,
        useSystemFonts: true,
        standardFontDataUrl: null,
      });

      // Attach a tail .catch BEFORE awaiting so any late rejection from
      // the loading task's background work (worker init, font preloads)
      // cannot escape as a process-level unhandled rejection.
      loadingTask.promise.catch((lateError: unknown) => {
        this.logger.warn(
          `Late getDocument rejection: submissionId=${submissionId} ` +
            `${lateError instanceof Error ? lateError.message : String(lateError)}`,
        );
      });
      const pdfDocument: PDFDocumentProxy = await loadingTask.promise;
      const numberPages = pdfDocument.numPages ?? 0;

      this.logger.debug(
        `Loaded PDF with ${numberPages} pages for structured extraction`,
      );

      const pages: StructuredPage[] = [];
      // Shared across pages so a document cannot accumulate an unbounded
      // number of decoded images no matter how they are distributed.
      const imageBudget: PdfImageBudget = {
        remaining: MAX_IMAGES_PER_DOCUMENT,
      };
      for (let pageNumber = 1; pageNumber <= numberPages; pageNumber++) {
        try {
          const page = await this.extractPageStructure(
            pdfDocument,
            pageNumber,
            warnings,
            imageBudget,
          );
          pages.push(page);
        } catch (error) {
          warnings.push(
            `Failed to extract page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.logger.warn(`Page ${pageNumber} extraction failed`, error);

          pages.push({
            pageNumber: pageNumber,
            blocks: [
              {
                blockId: `p${pageNumber}b0`,
                type: "unknown",
                text: "[Page extraction failed]",
                page: pageNumber,
              },
            ],
          });
        }
      }

      const allBlocks = pages.flatMap((p) => p.blocks);

      // Mirror the spreadsheet ingestion ceiling onto the PDF path. A
      // pathological PDF (thousands of pages) expands into an unbounded block
      // array that is graded with no size guard and can crash the worker pod.
      // Reject before returning the assembled submission.
      this.enforceBlockCap(allBlocks.length, submissionId);

      const wordCount = this.calculateWordCount(allBlocks);
      const checksum = sha256Short;

      const sections = this.detectSections(pages);

      const submission: CanonicalSubmission = {
        submissionId,
        metadata: {
          wordCount,
          pageCount: pages.length,
          blockCount: allBlocks.length,
          detectedSections: sections.map((s) => s.title),
          sourceType: "pdf",
          checksum,
          extractedAt: new Date().toISOString(),
        },
        pages,
        sections: sections.length > 0 ? sections : undefined,
      };

      const duration = Date.now() - startTime;

      const structureQuality = this.assessStructureQuality(pages, warnings);

      const metadata: ExtractionMetadata = {
        extractionMethod: "pdfjs",
        extractionDuration: duration,
        warnings,
        structureQuality,
      };

      this.logger.log(
        `Structured extraction completed: submissionId=${submissionId} ` +
          `pages=${pages.length} blocks=${allBlocks.length} ` +
          `words=${wordCount} durationMs=${duration} ` +
          `byteSize=${byteSize} sha256=${sha256Short} magicBytes=${magicBytesHex} ` +
          `warnings=${warnings.length}`,
      );

      return { submission, metadata };
    } catch (error) {
      // The oversized-submission guard is a terminal, non-retryable rejection.
      // Re-throw it unchanged so its name survives for downstream
      // classification — wrapping it in a generic Error would erase that
      // signal and make the failure look retryable.
      if (error instanceof OversizedSubmissionError) {
        throw error;
      }
      this.logger.error(
        `PDF structure extraction failed: submissionId=${submissionId} ` +
          `byteSize=${byteSize} sha256=${sha256Short} magicBytes=${magicBytesHex} ` +
          `error=${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `Failed to extract PDF structure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Enforce the per-submission evidence-block ceiling on the assembled PDF
   * blocks. Mirrors the spreadsheet guard so both ingestion paths share the
   * same limit. Throws OversizedSubmissionError (terminal, non-retryable) when
   * the count exceeds the cap.
   */
  private enforceBlockCap(blockCount: number, submissionId: string): void {
    if (blockCount <= MAX_EVIDENCE_BLOCKS_PER_SUBMISSION) {
      return;
    }
    this.logger.warn(
      `grading.submission.oversized ${JSON.stringify({
        blockCount,
        cap: MAX_EVIDENCE_BLOCKS_PER_SUBMISSION,
        submissionId,
        branch: "pdf",
      })}`,
    );
    throw new OversizedSubmissionError({
      blockCount,
      cap: MAX_EVIDENCE_BLOCKS_PER_SUBMISSION,
      filename: submissionId,
    });
  }

  /**
   * Extract structured content from a single page
   */
  private async extractPageStructure(
    pdfDocument: PDFDocumentProxy,
    pageNumber: number,
    warnings: string[],
    imageBudget?: PdfImageBudget,
  ): Promise<StructuredPage> {
    const pageTask = pdfDocument.getPage(pageNumber);
    pageTask.catch((lateError: unknown) => {
      this.logger.warn(
        `Late getPage rejection on page ${pageNumber}: ` +
          `${lateError instanceof Error ? lateError.message : String(lateError)}`,
      );
    });
    const page = await pageTask;
    try {
      const viewport = page.getViewport({ scale: 1 });

      const textContentTask = page.getTextContent();
      textContentTask.catch((lateError: unknown) => {
        this.logger.warn(
          `Late getTextContent rejection on page ${pageNumber}: ` +
            `${lateError instanceof Error ? lateError.message : String(lateError)}`,
        );
      });
      const textContent = await textContentTask;
      const textItems = this.normalizeTextItems(textContent.items);

      const blocks = this.groupTextItemsIntoBlocks(
        textItems,
        pageNumber,
        viewport,
      );

      const typedBlocks = this.detectBlockTypes(blocks);

      const imageBlocks = await this.extractImagesFromPage(
        page,
        pageNumber,
        warnings,
        imageBudget,
      );

      const allBlocks = [...typedBlocks, ...imageBlocks];

      return {
        pageNumber: pageNumber,
        blocks: allBlocks,
        metadata: {
          width: viewport.width,
          height: viewport.height,
          rotation: viewport.rotation,
        },
      };
    } finally {
      // Best-effort release of worker-side resources for this page. cleanup()
      // is synchronous in pdfjs-dist; wrap in try/catch so a cleanup failure
      // cannot mask the real return value or throw out of finally.
      try {
        page.cleanup();
      } catch (cleanupError) {
        this.logger.debug(
          `page.cleanup() failed for page ${pageNumber}: ` +
            `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }
    }
  }

  private normalizeTextItems(
    items: TextContent["items"],
  ): NormalizedTextItem[] {
    return items
      .map((item) => {
        const candidate = item as Partial<PdfJsTextItem>;
        const transform = Array.isArray(candidate.transform)
          ? candidate.transform
              .map(Number)
              .filter((value) => Number.isFinite(value))
          : [];
        const width = typeof candidate.width === "number" ? candidate.width : 0;
        const height =
          typeof candidate.height === "number" ? candidate.height : 0;

        if (
          typeof candidate.str !== "string" ||
          transform.length < 6 ||
          !Number.isFinite(width) ||
          !Number.isFinite(height)
        ) {
          return null;
        }

        return {
          str: candidate.str,
          dir: candidate.dir ?? "ltr",
          fontName: candidate.fontName ?? "",
          hasEOL: candidate.hasEOL,
          transform: transform,
          width,
          height,
        };
      })
      .filter((item): item is NormalizedTextItem => item !== null);
  }

  /**
   * Group text items into logical blocks based on position
   * This preserves reading order
   */
  private groupTextItemsIntoBlocks(
    items: NormalizedTextItem[],
    pageNumber: number,
    viewport: PageViewport,
  ): ContentBlock[] {
    void viewport;
    if (!items || items.length === 0) {
      return [];
    }

    const blocks: ContentBlock[] = [];
    let currentBlock: {
      items: NormalizedTextItem[];
      minY: number;
      maxY: number;
      minX: number;
      maxX: number;
    } | null = null;

    const sortedItems = [...items].sort((a, b) => {
      const yA = a.transform[5];
      const yB = b.transform[5];
      if (Math.abs(yA - yB) < 2) {
        return a.transform[4] - b.transform[4];
      }
      return yB - yA;
    });

    for (const item of sortedItems) {
      const text = item.str.trim();
      if (!text) continue;

      const y = item.transform[5];
      const x = item.transform[4];
      const height = item.height ?? 12;
      const width = item.width ?? 0;

      if (
        !currentBlock ||
        Math.abs(y - currentBlock.maxY) > height * 1.5 ||
        (x < currentBlock.minX - 50 && Math.abs(y - currentBlock.maxY) > 5)
      ) {
        if (currentBlock && currentBlock.items.length > 0) {
          const blockText = currentBlock.items.map((it) => it.str).join(" ");
          const blockId = `p${pageNumber}b${blocks.length}`;

          blocks.push({
            blockId,
            type: "unknown",
            text: blockText.trim(),
            page: pageNumber,
            bbox: {
              x: currentBlock.minX,
              y: currentBlock.minY,
              width: currentBlock.maxX - currentBlock.minX,
              height: currentBlock.maxY - currentBlock.minY,
            },
          });
        }

        currentBlock = {
          items: [item],
          minY: y,
          maxY: y + height,
          minX: x,
          maxX: x + width,
        };
      } else {
        currentBlock.items.push(item);
        currentBlock.minY = Math.min(currentBlock.minY, y);
        currentBlock.maxY = Math.max(currentBlock.maxY, y + height);
        currentBlock.minX = Math.min(currentBlock.minX, x);
        currentBlock.maxX = Math.max(currentBlock.maxX, x + width);
      }
    }

    if (currentBlock && currentBlock.items.length > 0) {
      const blockText = currentBlock.items.map((it) => it.str).join(" ");
      const blockId = `p${pageNumber}b${blocks.length}`;

      blocks.push({
        blockId,
        type: "unknown",
        text: blockText.trim(),
        page: pageNumber,
        bbox: {
          x: currentBlock.minX,
          y: currentBlock.minY,
          width: currentBlock.maxX - currentBlock.minX,
          height: currentBlock.maxY - currentBlock.minY,
        },
      });
    }

    return blocks;
  }

  /**
   * Detect block types using heuristics
   * This is deterministic and rule-based (no LLM)
   */
  private detectBlockTypes(blocks: ContentBlock[]): ContentBlock[] {
    return blocks.map((block) => {
      const text = block.text;

      if (
        text.length < 100 &&
        !text.endsWith(".") &&
        !text.endsWith(",") &&
        (/^(\d+\.?|\w+\.)\s+[A-Z]/.test(text) ||
          /^[A-Z][\sA-Z]+$/.test(text) ||
          (text.length < 50 && /^[A-Z]/.test(text)))
      ) {
        const level = /^#{1,6}\s/.test(text)
          ? text.match(/^#{1,6}/)?.[0].length || 1
          : /^[A-Z][\sA-Z]+$/.test(text)
            ? 1
            : 2;

        return { ...block, type: "heading" as BlockType, level };
      }

      if (
        /^\s{4,}/.test(text) ||
        /[();{}]/.test(text) ||
        /\b(function|class|def|import|const|let|var|return|if|else)\b/.test(
          text,
        )
      ) {
        const language = this.detectCodeLanguage(text);
        return { ...block, type: "code" as BlockType, language };
      }

      if (/[()[\]{}±×÷π∏∑√∞∫≈≠≤≥]/.test(text)) {
        return { ...block, type: "equation" as BlockType };
      }

      if (/^\s*[*•-]\s/.test(text) || /^\s*\d+[).]\s/.test(text)) {
        return { ...block, type: "list" as BlockType };
      }

      if (/^[">]\s/.test(text) || /^\s{2,}[A-Z]/.test(text)) {
        return { ...block, type: "quote" as BlockType };
      }

      return { ...block, type: "paragraph" as BlockType };
    });
  }

  /**
   * Simple code language detection
   */
  private detectCodeLanguage(text: string): string | undefined {
    if (/\b(function|const|let|var|=>)\b/.test(text)) return "javascript";
    if (/\b(def|import|class|if __name__)\b/.test(text)) return "python";
    if (/\b(public|private|class|void|static)\b/.test(text)) return "java";
    if (/\b(#include|iostream|std::)\b/.test(text)) return "cpp";
    return undefined;
  }

  /**
   * Extract images from a PDF page
   * Uses pdfjs-dist's operator list to find and extract image data
   */
  private isRenderableImage(image: unknown): image is PdfImageData {
    if (!image || typeof image !== "object") {
      return false;
    }

    const candidate = image as Partial<PdfImageData>;
    const hasDataArray =
      candidate.data instanceof Uint8ClampedArray ||
      candidate.data instanceof Uint8Array ||
      Array.isArray(candidate.data);

    return (
      hasDataArray &&
      typeof candidate.width === "number" &&
      typeof candidate.height === "number"
    );
  }

  private imageResolveTimeoutMs(): number {
    const parsed = Number.parseInt(
      process.env.PDF_IMAGE_RESOLVE_TIMEOUT_MS ?? "",
      10,
    );
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_IMAGE_RESOLVE_TIMEOUT_MS;
  }

  private getObjectStores(page: PDFPageProxy): PdfObjectStore[] {
    const candidate = page as unknown as {
      objs?: PdfObjectStore;
      commonObjs?: PdfObjectStore;
    };
    return [candidate.objs, candidate.commonObjs].filter(
      (store): store is PdfObjectStore =>
        !!store && typeof store.get === "function",
    );
  }

  /**
   * Resolve a decoded image from the pdfjs object stores.
   *
   * The worker publishes image objects asynchronously, AFTER getOperatorList()
   * resolves, so a synchronous `has()` immediately after the await is false for
   * every image in the document. Prefer the value if it has already landed,
   * otherwise register the callback form on both stores (page-local and
   * document-wide) and wait, bounded by the caller's deadline.
   *
   * Resolves to undefined when the object never arrives in time.
   */
  private async resolveImageObject(
    page: PDFPageProxy,
    objectId: string,
    timeoutMs: number,
  ): Promise<unknown> {
    const stores = this.getObjectStores(page);

    for (const store of stores) {
      if (store.has(objectId)) {
        try {
          return store.get(objectId);
        } catch (storeError) {
          // Published-but-unreadable: fall through to the async wait rather
          // than dropping the image on a transient store state.
          this.logger.debug(
            `Image ${objectId} reported present but not readable: ` +
              `${storeError instanceof Error ? storeError.message : String(storeError)}`,
          );
        }
      }
    }

    if (timeoutMs <= 0) {
      return undefined;
    }

    return await new Promise<unknown>((resolve) => {
      let settled = false;
      const settle = (value?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => settle(), timeoutMs);
      // Never hold the process open for an image that will not arrive.
      timer.unref?.();
      for (const store of stores) {
        store.get(objectId, settle);
      }
    });
  }

  /**
   * Collect every image-painting site in a page's operator list.
   *
   * Operators are matched through the pdfjs OPS enum rather than literal ids,
   * and each operator family carries its image differently: an object id
   * string, mask parameters whose `data` field holds the object id, an array of
   * such parameters, or the decoded image inline. Object ids are de-duplicated
   * so an image painted repeatedly on one page is extracted once.
   */
  private collectImageReferences(operatorList: PDFOperatorList): {
    references: PdfImageReference[];
    operatorCount: number;
  } {
    const { OPS } = pdfjs;
    const references: PdfImageReference[] = [];
    const seenObjectIds = new Set<string>();
    let operatorCount = 0;

    const addObjectReference = (operator: string, value: unknown): void => {
      if (typeof value !== "string" || seenObjectIds.has(value)) return;
      seenObjectIds.add(value);
      references.push({ operator, objectId: value });
    };

    // Mask operators pass { data: <objectId>, width, height, ... } rather than
    // a bare name.
    const addMaskReference = (operator: string, value: unknown): void => {
      if (!value || typeof value !== "object") return;
      addObjectReference(operator, (value as { data?: unknown }).data);
    };

    for (const [index, functionId] of operatorList.fnArray.entries()) {
      const argumentsEntry: unknown = operatorList.argsArray[index];
      const arguments_: unknown[] = Array.isArray(argumentsEntry)
        ? argumentsEntry
        : [];

      switch (functionId) {
        case OPS.paintImageXObject: {
          operatorCount++;
          addObjectReference("paintImageXObject", arguments_[0]);
          break;
        }
        case OPS.paintImageXObjectRepeat: {
          operatorCount++;
          addObjectReference("paintImageXObjectRepeat", arguments_[0]);
          break;
        }
        case OPS.paintImageMaskXObject: {
          operatorCount++;
          addMaskReference("paintImageMaskXObject", arguments_[0]);
          break;
        }
        case OPS.paintImageMaskXObjectRepeat: {
          operatorCount++;
          addMaskReference("paintImageMaskXObjectRepeat", arguments_[0]);
          break;
        }
        case OPS.paintImageMaskXObjectGroup: {
          operatorCount++;
          if (Array.isArray(arguments_[0])) {
            for (const entry of arguments_[0] as unknown[]) {
              addMaskReference("paintImageMaskXObjectGroup", entry);
            }
          }
          break;
        }
        case OPS.paintInlineImageXObject: {
          operatorCount++;
          references.push({
            operator: "paintInlineImageXObject",
            inline: arguments_[0],
          });
          break;
        }
        case OPS.paintInlineImageXObjectGroup: {
          operatorCount++;
          references.push({
            operator: "paintInlineImageXObjectGroup",
            inline: arguments_[0],
          });
          break;
        }
        case OPS.paintSolidColorImageMask: {
          // A single opaque pixel — counted so the page log is honest, but it
          // carries no picture worth describing.
          operatorCount++;
          break;
        }
        default: {
          break;
        }
      }
    }

    return { references, operatorCount };
  }

  private async extractImagesFromPage(
    page: PDFPageProxy,
    pageNumber: number,
    warnings: string[],
    budget?: PdfImageBudget,
  ): Promise<ContentBlock[]> {
    const imageBlocks: ContentBlock[] = [];
    const startTime = Date.now();
    let operatorCount = 0;
    let candidateCount = 0;
    let unresolved = 0;
    let skipped = 0;
    let dropped = 0;

    try {
      // NOTE: we deliberately do NOT render the page to a canvas here. The
      // previous full-page page.render() called the pdfjs v4 render API under
      // v5 (which rejects with "Image or Canvas expected") and was the
      // native-crash trigger — a SIGSEGV in the canvas addon and the unhandled
      // AbortException that exited the worker. Image data comes from the
      // operator list plus the object stores below instead; because those are
      // populated asynchronously, each image is awaited rather than probed.
      const operatorListTask = page.getOperatorList();
      // Same late-rejection guard for getOperatorList — it returns a Promise
      // directly, so attach .catch to the Promise itself.
      operatorListTask.catch((lateError: unknown) => {
        this.logger.warn(
          `Late getOperatorList rejection on page ${pageNumber}: ` +
            `${lateError instanceof Error ? lateError.message : String(lateError)}`,
        );
      });
      const operatorList: PDFOperatorList = await operatorListTask;

      const collected = this.collectImageReferences(operatorList);
      operatorCount = collected.operatorCount;
      candidateCount = collected.references.length;

      // One deadline for the whole page: the worker publishes the page's
      // images together, so waiting per-image would multiply the worst case.
      const deadline = Date.now() + this.imageResolveTimeoutMs();

      let imageIndex = 0;

      for (const reference of collected.references) {
        if (
          imageIndex >= MAX_IMAGES_PER_PAGE ||
          (budget && budget.remaining <= 0)
        ) {
          dropped = candidateCount - imageIndex - skipped - unresolved;
          break;
        }

        const label = reference.objectId ?? reference.operator;

        try {
          const image = reference.objectId
            ? await this.resolveImageObject(
                page,
                reference.objectId,
                deadline - Date.now(),
              )
            : reference.inline;

          if (image === undefined || image === null) {
            unresolved++;
            continue;
          }

          if (!this.isRenderableImage(image)) {
            skipped++;
            this.logger.debug(
              `Skipping unusable image ${label} on page ${pageNumber}: no data or dimensions`,
            );
            continue;
          }

          const pixels = image.width * image.height;
          if (!Number.isFinite(pixels) || pixels <= 0) {
            skipped++;
            continue;
          }
          if (pixels > MAX_IMAGE_PIXELS) {
            skipped++;
            this.logger.warn(
              `pdf.images.oversized ${JSON.stringify({
                page: pageNumber,
                width: image.width,
                height: image.height,
                cap: MAX_IMAGE_PIXELS,
              })}`,
            );
            continue;
          }

          const { imageData, format, width, height } =
            await this.convertImageToBase64(image);

          const blockId = `p${pageNumber}b_img${imageIndex}`;

          imageBlocks.push({
            blockId,
            type: "image" as BlockType,
            text: `[Image ${imageIndex + 1} on page ${pageNumber}]`,
            page: pageNumber,
            imageData,
            imageMetadata: {
              width,
              height,
              format,
            },
          });

          imageIndex++;
          if (budget) budget.remaining--;
        } catch (imageError) {
          skipped++;
          const errorMessage =
            imageError instanceof Error
              ? imageError.message
              : String(imageError);
          warnings.push(
            `Failed to extract image ${label} from page ${pageNumber}: ${errorMessage}`,
          );
          this.logger.warn(
            `Image extraction error on page ${pageNumber}: ${errorMessage} (skipping)`,
          );
        }
      }

      // Dropping a learner's diagram must never be invisible: surface it as an
      // extraction warning (which feeds structureQuality) and a warn log.
      if (unresolved > 0) {
        warnings.push(
          `${unresolved} image(s) on page ${pageNumber} were not published by the PDF reader in time`,
        );
        this.logger.warn(
          `pdf.images.unresolved ${JSON.stringify({
            page: pageNumber,
            unresolved,
            timeoutMs: this.imageResolveTimeoutMs(),
          })}`,
        );
      }
      if (dropped > 0) {
        warnings.push(
          `${dropped} image(s) on page ${pageNumber} were dropped by the extraction limit`,
        );
        this.logger.warn(
          `pdf.images.capped ${JSON.stringify({
            page: pageNumber,
            dropped,
            perPageCap: MAX_IMAGES_PER_PAGE,
            documentBudgetRemaining: budget?.remaining,
          })}`,
        );
      }

      if (operatorCount > 0) {
        this.logger.log(
          `pdf.images.extracted ${JSON.stringify({
            page: pageNumber,
            imageOperators: operatorCount,
            candidates: candidateCount,
            extracted: imageIndex,
            skipped,
            unresolved,
            dropped,
            durationMs: Date.now() - startTime,
          })}`,
        );
      }
    } catch (error) {
      warnings.push(
        `Failed to extract images from page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.logger.warn(`Page ${pageNumber} image extraction failed`, error);
    }

    return imageBlocks;
  }

  /**
   * A pdfjs stencil mask: no colour `kind`, and exactly one bit per pixel.
   * Monochrome diagram exports commonly paint through these.
   */
  private isPackedImageMask(image: PdfImageData): boolean {
    if (image.kind !== undefined) return false;
    const expectedLength = ((image.width + 7) >> 3) * image.height;
    return expectedLength > 0 && image.data.length === expectedLength;
  }

  /**
   * Expand a 1-bit stencil mask into opaque RGBA. pdfjs has already folded any
   * /Decode inversion into the data, so a clear bit means "paint".
   */
  private writeImageMaskPixels(
    destination: Uint8ClampedArray,
    image: PdfImageData,
  ): void {
    const { width, height, data: source } = image;
    const rowBytes = (width + 7) >> 3;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = source[y * rowBytes + (x >> 3)] ?? 0xff;
        const painted = (byte & (0b1000_0000 >> (x & 7))) === 0;
        const value = painted ? 0 : 255;
        const offset = (y * width + x) * 4;
        destination[offset] = value;
        destination[offset + 1] = value;
        destination[offset + 2] = value;
        destination[offset + 3] = 255;
      }
    }
  }

  /**
   * Convert PDF image object to base64 string
   */
  private async convertImageToBase64(image: PdfImageData): Promise<{
    imageData: string;
    format: string;
    width: number;
    height: number;
  }> {
    const width = image.width;
    const height = image.height;
    const format = "png";

    try {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Failed to create canvas context for image conversion");
      }

      const imageData = context.createImageData(width, height);
      const data = image.data;

      if (this.isPackedImageMask(image)) {
        // Stencil masks arrive as 1 bit per pixel with no `kind`. Render them
        // opaque black-on-white: transparent pixels would leave a vision model
        // nothing to look at.
        this.writeImageMaskPixels(imageData.data, image);
        context.putImageData(imageData, 0, 0);

        return {
          imageData: canvas.toDataURL(`image/${format}`),
          format,
          width,
          height,
        };
      }

      const kind = image.kind ?? 2;

      switch (kind) {
        case 1: {
          for (const [index, datum] of data.entries()) {
            const offset = index * 4;
            imageData.data[offset] = datum;
            imageData.data[offset + 1] = datum;
            imageData.data[offset + 2] = datum;
            imageData.data[offset + 3] = 255;
          }

          break;
        }
        case 2: {
          for (let index = 0; index < data.length; index += 3) {
            const offset = (index / 3) * 4;
            imageData.data[offset] = data[index];
            imageData.data[offset + 1] = data[index + 1];
            imageData.data[offset + 2] = data[index + 2];
            imageData.data[offset + 3] = 255;
          }

          break;
        }
        case 3:
        case 4: {
          imageData.data.set(data.slice(0, imageData.data.length));

          break;
        }
        default: {
          this.logger.warn(
            `Unknown image kind: ${kind}, attempting RGB conversion`,
          );
          for (
            let index = 0;
            index < data.length && index < imageData.data.length - 2;
            index += 3
          ) {
            const offset = (index / 3) * 4;
            imageData.data[offset] = data[index];
            imageData.data[offset + 1] = data[index + 1];
            imageData.data[offset + 2] = data[index + 2];
            imageData.data[offset + 3] = 255;
          }
        }
      }

      context.putImageData(imageData, 0, 0);

      const base64 = canvas.toDataURL(`image/${format}`);

      return {
        imageData: base64,
        format,
        width,
        height,
      };
    } catch (error) {
      this.logger.error(
        `Failed to convert image to base64: ${error instanceof Error ? error.message : String(error)}`,
        {
          width,
          height,
          kind: image.kind,
          dataLength: image.data?.length,
        },
      );
      throw error;
    }
  }

  /**
   * Detect sections based on heading structure
   * This is lightweight and deterministic
   */
  private detectSections(pages: StructuredPage[]): DocumentSection[] {
    const sections: DocumentSection[] = [];
    let currentSection: DocumentSection | null = null;

    for (const page of pages) {
      for (const block of page.blocks) {
        if (block.type === "heading") {
          if (currentSection) {
            sections.push(currentSection);
          }

          currentSection = {
            sectionId: `s${sections.length}`,
            title: block.text,
            pages: [page.pageNumber],
            contentBlocks: [block.blockId],
            level: block.level || 1,
          };
        } else if (currentSection) {
          if (!currentSection.pages.includes(page.pageNumber)) {
            currentSection.pages.push(page.pageNumber);
          }
          currentSection.contentBlocks.push(block.blockId);
        }
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * Calculate total word count
   */
  private calculateWordCount(blocks: ContentBlock[]): number {
    let count = 0;
    for (const block of blocks) {
      const words = block.text.split(/\s+/).filter((word) => word.length > 0);
      count += words.length;
    }
    return count;
  }

  /**
   * Assess extraction quality
   */
  private assessStructureQuality(
    pages: StructuredPage[],
    warnings: string[],
  ): "high" | "medium" | "low" {
    if (warnings.length > pages.length * 0.3) return "low";

    const allBlocks = pages.flatMap((p) => p.blocks);
    const typedBlocks = allBlocks.filter((b) => b.type !== "unknown");

    const typeRatio = typedBlocks.length / allBlocks.length;

    if (typeRatio > 0.7) return "high";
    if (typeRatio > 0.3) return "medium";
    return "low";
  }
}
