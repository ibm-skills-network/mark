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

interface HtmlParagraph {
  text: string;
  selector?: string;
}

@Injectable()
export class EvidenceChunkingService {
  extractFromSubmission(submission: CanonicalSubmission): ExtractedChunk[] {
    const chunks: ExtractedChunk[] = [];

    for (const page of submission.pages) {
      for (const block of page.blocks) {
        const text = this.buildBlockText(block);
        if (!text) continue;

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

        const chunk = this.createChunk({
          text,
          sourceType: "file",
          sourceId: submission.submissionId,
          anchor,
          metadata: {
            filename: submission.submissionId,
            pageCount: submission.metadata.pageCount,
            structured: true,
            checksum: submission.metadata.checksum,
          },
        });

        chunks.push(chunk);
      }
    }

    return chunks;
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
