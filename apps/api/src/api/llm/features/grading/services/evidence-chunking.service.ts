import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  CanonicalSubmission,
  ContentBlock,
} from "src/api/attempt/services/structured-content.models";
import {
  EvidenceAnchor,
  EvidenceSourceType,
  ExtractedChunk,
} from "../types/criterion-evidence.types";
import { LearnerImageUpload } from "src/api/llm/model/image.based.evalutate.model";
import {
  DOC_WHOLE_SUBMISSION_BLOCK_MAX_CHARS,
  PROSE_SECTION_MAX_CHARS,
  sanitizeFilenameForMarker,
} from "./source-code.utils";

interface HtmlParagraph {
  text: string;
  selector?: string;
}

interface ProseSection {
  firstBlock: ContentBlock;
  sourceFilename: string | undefined;
  texts: string[];
  chars: number;
}

@Injectable()
export class EvidenceChunkingService {
  extractFromSubmission(submission: CanonicalSubmission): ExtractedChunk[] {
    const chunks: ExtractedChunk[] = [];
    // Page-labelled prose accumulated for the whole-document block below.
    const prosePages = new Map<number, string[]>();
    let hasPinnedBlock = false;
    let sectionCount = 0;
    let firstProseBlock: ContentBlock | undefined;
    let omittedNonProse = false;

    for (const page of submission.pages) {
      // Document extraction (PDF especially) emits line-level text runs, one
      // block per run. One chunk per block starves evidence retrieval: a
      // 40-page deck becomes ~500 chunks with a median under 100 chars, so
      // no chunk ever contains a slide's worth of content and the validator
      // ends up judging criteria on isolated headings. Merge consecutive
      // prose blocks into bounded per-page sections so a chunk carries the
      // unit rubrics actually ask about (a slide, a page).
      let section: ProseSection | null = null;

      const flushSection = () => {
        if (!section) return;
        chunks.push(this.createProseSectionChunk(submission, section));
        sectionCount += 1;
        section = null;
      };

      for (const block of page.blocks) {
        const text = this.buildBlockText(block);
        if (!text) continue;

        // Images, code, and explicitly pinned blocks keep their own chunk:
        // images carry image anchors, code segments are already sized, and
        // pinned blocks (the code whole-file view) have their own contract.
        const standalone =
          block.type === "image" ||
          block.type === "code" ||
          block.pinnedEvidence;
        if (standalone) {
          flushSection();
          if (block.pinnedEvidence) hasPinnedBlock = true;
          omittedNonProse = true;
          chunks.push(this.createBlockChunk(submission, block, text));
          continue;
        }

        firstProseBlock ??= block;
        const pageTexts = prosePages.get(block.page) ?? [];
        pageTexts.push(text);
        prosePages.set(block.page, pageTexts);

        // A single block above the section cap never merges; split it into
        // capped pieces instead, each its own section chunk. Every piece is a
        // substring of the block's text, so highlight lookup inside the
        // anchored block still succeeds.
        if (text.length > PROSE_SECTION_MAX_CHARS) {
          flushSection();
          for (const piece of this.splitOversizedText(text)) {
            chunks.push(
              this.createProseSectionChunk(submission, {
                firstBlock: block,
                sourceFilename: block.sourceFilename,
                texts: [piece],
                chars: piece.length,
              }),
            );
            sectionCount += 1;
          }
          continue;
        }

        const fitsSection =
          section !== null &&
          section.sourceFilename === block.sourceFilename &&
          section.chars + text.length + 1 <= PROSE_SECTION_MAX_CHARS;
        if (!fitsSection) {
          flushSection();
          section = {
            firstBlock: block,
            sourceFilename: block.sourceFilename,
            texts: [],
            chars: 0,
          };
        }
        section.texts.push(text);
        section.chars += text.length + 1;
      }

      // Sections never span pages: a per-page chunk keeps the anchor honest
      // and matches how document rubrics are written (per slide/page).
      flushSection();
    }

    // Holistic criteria (organization, completeness, creativity) concern the
    // document as a unit, so document uploads get a pinned whole-document
    // view — the prose analog of the code whole-file block. Skipped when the
    // submission already carries a pinned block (code/notebook uploads) or
    // when a single section already holds the entire document.
    if (!hasPinnedBlock && sectionCount > 1 && firstProseBlock) {
      const wholeDocument = this.buildWholeDocumentChunk(
        submission,
        prosePages,
        firstProseBlock,
        omittedNonProse,
      );
      if (wholeDocument) chunks.push(wholeDocument);
    }

    return chunks;
  }

  // Split an oversized single block's text into section-sized pieces at
  // whitespace boundaries (hard cut when a run has none).
  private splitOversizedText(text: string): string[] {
    const pieces: string[] = [];
    let rest = text;
    while (rest.length > PROSE_SECTION_MAX_CHARS) {
      const window = rest.slice(0, PROSE_SECTION_MAX_CHARS);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
      const at = cut > PROSE_SECTION_MAX_CHARS / 2 ? cut : window.length;
      pieces.push(rest.slice(0, at).trimEnd());
      rest = rest.slice(at).trimStart();
    }
    if (rest.trim()) pieces.push(rest);
    return pieces;
  }

  private createBlockChunk(
    submission: CanonicalSubmission,
    block: ContentBlock,
    text: string,
  ): ExtractedChunk {
    const anchor: EvidenceAnchor =
      block.type === "image"
        ? {
            type: "image",
            page: block.page,
            boundingBox: block.bbox,
            ocrText: block.text || block.imageDescription || undefined,
            imageId: block.blockId,
          }
        : {
            type: "file",
            page: block.page,
            blockId: block.blockId,
            lineStart: 1,
            lineEnd: Math.max(1, block.text.split(/\n+/).length),
          };

    return this.createChunk({
      text,
      sourceType: "file",
      sourceId: submission.submissionId,
      anchor,
      metadata: {
        filename: block.sourceFilename ?? submission.submissionId,
        pageCount: submission.metadata.pageCount,
        structured: true,
        checksum: submission.metadata.checksum,
        ...(block.pinnedEvidence ? { pinned: true } : {}),
      },
    });
  }

  private createProseSectionChunk(
    submission: CanonicalSubmission,
    section: ProseSection,
  ): ExtractedChunk {
    const text = section.texts.join("\n");
    return this.createChunk({
      text,
      sourceType: "file",
      sourceId: submission.submissionId,
      anchor: {
        type: "file",
        page: section.firstBlock.page,
        blockId: section.firstBlock.blockId,
        lineStart: 1,
        lineEnd: Math.max(1, text.split(/\n+/).length),
      },
      metadata: {
        filename: section.sourceFilename ?? submission.submissionId,
        pageCount: submission.metadata.pageCount,
        structured: true,
        checksum: submission.metadata.checksum,
        section: true,
        anchorTextChars: section.texts[0].length,
      },
    });
  }

  private buildWholeDocumentChunk(
    submission: CanonicalSubmission,
    prosePages: Map<number, string[]>,
    firstProseBlock: ContentBlock,
    omittedNonProse: boolean,
  ): ExtractedChunk | null {
    const pageNumbers = [...prosePages.keys()].sort((a, b) => a - b);
    if (pageNumbers.length === 0) return null;

    const name =
      sanitizeFilenameForMarker(submission.submissionId) || "submission";
    const marker = "\n... [document truncated]";
    const truncatedHeader = `=== DOCUMENT: ${name} (truncated) ===\n`;
    const bodyParts: string[] = [];
    for (const pageNumber of pageNumbers) {
      bodyParts.push(
        `=== PAGE ${pageNumber} ===\n${(prosePages.get(pageNumber) ?? []).join("\n")}`,
      );
    }
    const body = bodyParts.join("\n");

    // Mirrors the code whole-file block: the ENTIRE text (header + body +
    // marker) is bounded, and a document only counts as truncated when the
    // complete block would not fit. "(complete)" would be a lie when image or
    // code blocks were left out of this prose aggregate — the grader is told
    // to trust shown-vs-truncated distinctions — so those documents get the
    // honest "(text content)" label instead.
    const wholeLabel = omittedNonProse ? "text content" : "complete";
    const completeText = `=== DOCUMENT: ${name} (${wholeLabel}) ===\n${body}`;
    const bodyBudget =
      DOC_WHOLE_SUBMISSION_BLOCK_MAX_CHARS -
      truncatedHeader.length -
      marker.length;
    const text =
      completeText.length <= DOC_WHOLE_SUBMISSION_BLOCK_MAX_CHARS
        ? completeText
        : `${truncatedHeader}${body.slice(0, bodyBudget)}${marker}`;

    // Anchor at the first prose block (not a synthetic id): citations then
    // resolve to a real block for highlighting, and nothing learner-facing
    // falls back to a bare chunk hash.
    const firstProseText = prosePages.get(pageNumbers[0])?.[0] ?? "";
    return this.createChunk({
      text,
      sourceType: "file",
      sourceId: submission.submissionId,
      anchor: {
        type: "file",
        page: firstProseBlock.page,
        blockId: firstProseBlock.blockId,
        lineStart: 1,
        lineEnd: Math.max(1, text.split(/\n+/).length),
      },
      metadata: {
        filename: submission.submissionId,
        pageCount: submission.metadata.pageCount,
        structured: true,
        checksum: submission.metadata.checksum,
        pinned: true,
        wholeDocument: true,
        anchorTextChars: firstProseText.length,
      },
    });
  }

  extractFromText(
    text: string,
    sourceId = "learner-response",
  ): ExtractedChunk[] {
    const normalized = text || "";
    if (!normalized.trim()) return [];

    const paragraphs = this.splitIntoParagraphs(normalized);
    const chunks: ExtractedChunk[] = [];
    let cursor = 0;

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;

      const startOffset = this.findOffset(normalized, trimmed, cursor);
      const endOffset = startOffset + trimmed.length;
      cursor = endOffset;

      const anchor: EvidenceAnchor = {
        type: "text",
        startOffset,
        endOffset,
      };

      chunks.push(
        this.createChunk({
          text: trimmed,
          sourceType: "text",
          sourceId,
          anchor,
        }),
      );
    }

    return chunks;
  }

  extractFromUrl(url: string, body: string): ExtractedChunk[] {
    const paragraphs = this.extractParagraphsFromHtml(body);
    const chunks: ExtractedChunk[] = [];

    for (const [index, paragraph] of paragraphs.entries()) {
      if (!paragraph.text.trim()) continue;

      const anchor: EvidenceAnchor = {
        type: "url",
        url,
        paragraphIndex: index + 1,
        selector: paragraph.selector,
      };

      chunks.push(
        this.createChunk({
          text: paragraph.text,
          sourceType: "url",
          sourceId: url,
          anchor,
          metadata: { url },
        }),
      );
    }

    return chunks;
  }

  extractFromImages(images: LearnerImageUpload[]): ExtractedChunk[] {
    const chunks: ExtractedChunk[] = [];

    for (const [imageIndex, image] of images.entries()) {
      const detectedText = image.imageAnalysisResult?.detectedText || [];

      if (detectedText.length === 0) {
        const fallbackText =
          image.imageAnalysisResult?.rawDescription || "[Image content]";
        const anchor: EvidenceAnchor = {
          type: "image",
          imageId: image.filename,
        };

        chunks.push(
          this.createChunk({
            text: fallbackText,
            sourceType: "image",
            sourceId: image.filename,
            anchor,
            metadata: {
              filename: image.filename,
              mimeType: image.mimeType,
              imageIndex,
            },
          }),
        );
        continue;
      }

      for (const [snippetIndex, snippet] of detectedText.entries()) {
        const anchor: EvidenceAnchor = {
          type: "image",
          imageId: image.filename,
          boundingBox: snippet.boundingBox,
          ocrText: snippet.text,
        };

        chunks.push(
          this.createChunk({
            text: snippet.text,
            sourceType: "image",
            sourceId: image.filename,
            anchor,
            metadata: {
              filename: image.filename,
              mimeType: image.mimeType,
              imageIndex,
              checksum: `${imageIndex}:${snippetIndex}`,
            },
          }),
        );
      }
    }

    return chunks;
  }

  private buildBlockText(block: ContentBlock): string {
    if (block.type === "image") {
      const description = block.imageDescription || "";
      const ocr = block.text || "";
      return [ocr, description].filter(Boolean).join("\n").trim();
    }

    return block.text?.trim() || "";
  }

  private splitIntoParagraphs(text: string): string[] {
    const chunks = text
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim());

    if (chunks.length > 1) {
      return chunks.filter(Boolean);
    }

    return text
      .split(/\n+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }

  private extractParagraphsFromHtml(body: string): HtmlParagraph[] {
    if (!body) return [];

    const hasHtml = /<[^>]+>/.test(body);

    if (!hasHtml) {
      return this.splitIntoParagraphs(body).map((text) => ({ text }));
    }

    const sanitized = body
      .replaceAll(/<script[\S\s]*?<\/script>/gi, "")
      .replaceAll(/<style[\S\s]*?<\/style>/gi, "")
      .replaceAll(/<noscript[\S\s]*?<\/noscript>/gi, "");

    const paragraphMatches = [
      ...sanitized.matchAll(/<p[^>]*>([\S\s]*?)<\/p>/gi),
    ];

    if (paragraphMatches.length === 0) {
      const text = sanitized.replaceAll(/<[^>]+>/g, " ");
      return this.splitIntoParagraphs(text).map((paragraph, index) => ({
        text: paragraph,
        selector: `body:nth-of-type(1) > p:nth-of-type(${index + 1})`,
      }));
    }

    return paragraphMatches.map((match, index) => {
      const text = match[1].replaceAll(/<[^>]+>/g, " ").replaceAll(/\s+/g, " ");
      return {
        text: text.trim(),
        selector: `p:nth-of-type(${index + 1})`,
      };
    });
  }

  private findOffset(text: string, chunk: string, start: number): number {
    const index = text.indexOf(chunk, start);
    if (index >= 0) return index;
    return Math.max(0, start);
  }

  private createChunk(parameters: {
    text: string;
    sourceType: EvidenceSourceType;
    sourceId: string;
    anchor: EvidenceAnchor;
    metadata?: ExtractedChunk["metadata"];
  }): ExtractedChunk {
    const normalizedText = parameters.text.trim();
    const hashInput = `${parameters.sourceType}|${parameters.sourceId}|${JSON.stringify(
      parameters.anchor,
    )}|${normalizedText}`;

    const hash = crypto.createHash("sha256").update(hashInput).digest("hex");

    return {
      chunkId: hash.slice(0, 16),
      hash,
      text: normalizedText,
      sourceType: parameters.sourceType,
      sourceId: parameters.sourceId,
      anchor: parameters.anchor,
      metadata: parameters.metadata,
    };
  }
}
