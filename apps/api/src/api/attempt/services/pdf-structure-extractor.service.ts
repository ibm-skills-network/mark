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
  RenderParameters,
  TextContent,
  TextItem as PdfJsTextItem,
} from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist/types/src/display/display_utils";
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
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
  kind?: number;
}

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
      for (let pageNumber = 1; pageNumber <= numberPages; pageNumber++) {
        try {
          const page = await this.extractPageStructure(
            pdfDocument,
            pageNumber,
            warnings,
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
   * Extract structured content from a single page
   */
  private async extractPageStructure(
    pdfDocument: PDFDocumentProxy,
    pageNumber: number,
    warnings: string[],
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

  private async extractImagesFromPage(
    page: PDFPageProxy,
    pageNumber: number,
    warnings: string[],
  ): Promise<ContentBlock[]> {
    const imageBlocks: ContentBlock[] = [];

    try {
      const viewport = page.getViewport({ scale: 1 });

      try {
        const canvas = createCanvas(viewport.width, viewport.height);
        const canvasContext = canvas.getContext("2d");

        if (canvasContext) {
          const renderContext: RenderParameters = {
            canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
            viewport,
            canvas: null,
          };

          const renderTask = page.render(renderContext);
          // Attach a tail catch BEFORE awaiting so any late rejection
          // (e.g., font load or image decode resolving after the worker
          // already moved on) is captured here and cannot escape as an
          // unhandled promise rejection at the process level.
          renderTask.promise.catch((lateError: unknown) => {
            this.logger.warn(
              `Late render rejection on page ${pageNumber}: ` +
                `${lateError instanceof Error ? lateError.message : String(lateError)}`,
            );
          });
          await renderTask.promise;
        }
      } catch (renderError) {
        this.logger.debug(
          `Page ${pageNumber} render failed (continuing with image extraction): ${renderError instanceof Error ? renderError.message : String(renderError)}`,
        );
      }

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

      let imageIndex = 0;
      const imageNames: string[] = [];

      for (const [index, functionId] of operatorList.fnArray.entries()) {
        const argumentsEntry: unknown = operatorList.argsArray[index];
        const arguments_: unknown[] = Array.isArray(argumentsEntry)
          ? argumentsEntry
          : [];

        if (
          (functionId === 85 || functionId === 88) &&
          Array.isArray(arguments_) &&
          typeof arguments_[0] === "string"
        ) {
          imageNames.push(arguments_[0]);
        }
      }

      for (const imageName of imageNames) {
        try {
          if (!page.objs.has(imageName)) {
            this.logger.debug(
              `Skipping unresolved image ${imageName} on page ${pageNumber}`,
            );
            continue;
          }

          let image: unknown;
          try {
            image = page.objs.get(imageName);
          } catch {
            this.logger.debug(
              `Image ${imageName} not yet resolved on page ${pageNumber}, skipping`,
            );
            continue;
          }

          if (!this.isRenderableImage(image)) {
            this.logger.debug(
              `Skipping invalid image ${imageName} on page ${pageNumber}: no data or dimensions`,
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
        } catch (imageError) {
          const errorMessage =
            imageError instanceof Error
              ? imageError.message
              : String(imageError);
          warnings.push(
            `Failed to extract image ${imageName} from page ${pageNumber}: ${errorMessage}`,
          );
          this.logger.debug(
            `Image extraction error on page ${pageNumber}: ${errorMessage} (skipping)`,
          );
        }
      }

      if (imageIndex > 0) {
        this.logger.debug(
          `Extracted ${imageIndex} images from page ${pageNumber}`,
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
