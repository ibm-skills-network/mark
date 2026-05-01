import { Injectable, Logger } from "@nestjs/common";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "pdf-lib";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent,
  TextItem as PdfJsTextItem,
} from "pdfjs-dist/types/src/display/api";
import {
  FileHighlighting,
  TextHighlight,
  ResponseHighlighting,
  HighlightLevel,
} from "../../llm/model/highlighting.model";

interface AnnotationConfig {
  highlightOpacity: number;
  fontSize: number;
  minFontSize: number;
  commentWidth: number;
  commentPadding: number;
  commentGap: number;
  marginSize: number;
  sidebarWidth: number;
  sidebarPadding: number;
  sidebarTopMargin: number;
  sidebarBottomMargin: number;
}

interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExtractedTextItem {
  text: string;
  bbox: BBox;
  start: number;
  end: number;
}

interface ExtractedBlock {
  blockId: string;
  text: string;
  bbox: BBox;
  items: ExtractedTextItem[];
}

interface SimplifiedPdfItem {
  text: string;
  transform: number[];
  width: number;
  height: number;
}

@Injectable()
export class PdfAnnotationService {
  private readonly logger = new Logger(PdfAnnotationService.name);
  private readonly config: AnnotationConfig = {
    highlightOpacity: 0.3,
    fontSize: 10,
    minFontSize: 7,
    commentWidth: 260,
    commentPadding: 8,
    commentGap: 12,
    marginSize: 50,
    sidebarWidth: 340,
    sidebarPadding: 12,
    sidebarTopMargin: 90,
    sidebarBottomMargin: 60,
  };

  /**
   * Annotates a PDF with highlights and AI feedback comments
   * @param originalPdfBuffer Original PDF file buffer
   * @param highlighting Highlighting data from grading
   * @param studentName Optional student name for header
   * @returns Annotated PDF buffer
   */
  async annotatePdf(
    originalPdfBuffer: Buffer,
    highlighting: FileHighlighting,
    studentName?: string,
  ): Promise<Buffer> {
    try {
      this.logger.log("Starting PDF annotation process");

      const pdfDocument = await PDFDocument.load(originalPdfBuffer);
      const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold);

      const pageCount = pdfDocument.getPageCount();
      if (pageCount === 0) {
        throw new Error("PDF has no pages");
      }

      const pagesToAnnotate = Object.keys(highlighting.pages)
        .map(Number)
        .sort((a, b) => a - b);

      const blocksByPage = await this.extractBlocksByPage(
        originalPdfBuffer,
        pagesToAnnotate,
      );

      const originalPageWidths = new Map<number, number>();
      for (let index = 0; index < pageCount; index++) {
        const page = pdfDocument.getPage(index);
        const { width, height } = page.getSize();
        originalPageWidths.set(index, width);
        page.setSize(width + this.config.sidebarWidth, height);
      }

      await this.addHeaderToFirstPage(pdfDocument, font, boldFont, studentName);

      for (const pageNumberString of Object.keys(highlighting.pages)) {
        const pageNumber = Number(pageNumberString);
        const pageHighlighting = highlighting.pages[pageNumber];
        if (!pageHighlighting) continue;

        const pageIndex = pageNumber - 1;
        if (pageIndex >= 0 && pageIndex < pdfDocument.getPageCount()) {
          const page = pdfDocument.getPage(pageIndex);
          const originalWidth =
            originalPageWidths.get(pageIndex) ??
            page.getWidth() - this.config.sidebarWidth;
          await this.annotatePageWithHighlights(page, pageHighlighting, {
            blocksById: blocksByPage.get(pageNumber),
            font,
            boldFont,
            originalWidth,
          });
        }
      }

      await this.addSummaryPage(pdfDocument, highlighting, font, boldFont);

      const pdfBytes = await pdfDocument.save();
      this.logger.log("PDF annotation completed successfully");

      return Buffer.from(pdfBytes);
    } catch (error) {
      this.logger.error("Error annotating PDF:", error);
      throw new Error(
        `Failed to annotate PDF: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Add a header to the first page indicating this is an annotated version
   */
  private async addHeaderToFirstPage(
    pdfDocument: PDFDocument,
    font: PDFFont,
    boldFont: PDFFont,
    studentName?: string,
  ): Promise<void> {
    const firstPage = pdfDocument.getPage(0);
    const { width, height } = firstPage.getSize();

    firstPage.drawRectangle({
      x: 0,
      y: height - 60,
      width: width,
      height: 60,
      color: rgb(0.95, 0.95, 1),
      opacity: 0.9,
    });

    this.safeDrawText(firstPage, "AI GRADING FEEDBACK", {
      x: 20,
      y: height - 25,
      size: 16,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.6),
    });

    if (studentName) {
      this.safeDrawText(firstPage, `Student: ${studentName}`, {
        x: 20,
        y: height - 45,
        size: 10,
        font: font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }

    const date = new Date().toLocaleDateString();
    this.safeDrawText(firstPage, `Graded: ${date}`, {
      x: width - 120,
      y: height - 45,
      size: 10,
      font: font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }

  /**
   * Annotate a single page with highlights and comments
   */
  private async annotatePageWithHighlights(
    page: PDFPage,
    pageHighlighting: ResponseHighlighting,
    context: {
      blocksById?: Map<string, ExtractedBlock>;
      font: PDFFont;
      boldFont: PDFFont;
      originalWidth: number;
    },
  ): Promise<void> {
    const { blocksById, font, boldFont, originalWidth } = context;
    const { height } = page.getSize();
    const highlights = pageHighlighting.highlights || [];

    this.logger.debug(`Annotating page with ${highlights.length} highlights`);

    const sortedHighlights = [...highlights].sort((a, b) => b.start - a.start);

    for (const highlight of highlights) {
      const rects = this.resolveHighlightRects(
        highlight,
        pageHighlighting,
        blocksById,
      );
      if (rects.length === 0) {
        continue;
      }

      const color = this.getHighlightColor(highlight.level);
      const mergedRects = this.mergeRectsByLine(rects);

      for (const rect of mergedRects) {
        const clamped = this.clampRectToPage(rect, originalWidth, height);
        if (!clamped) continue;

        const padded = this.padRect(clamped, 1, originalWidth, height);
        if (!padded) continue;

        page.drawRectangle({
          x: padded.x,
          y: padded.y,
          width: padded.width,
          height: padded.height,
          color: rgb(color.r, color.g, color.b),
          opacity: this.config.highlightOpacity,
        });
      }
    }

    let commentYOffset = height - this.config.sidebarTopMargin;

    for (const highlight of sortedHighlights) {
      const color = this.getHighlightColor(highlight.level);

      const commentX = originalWidth + this.config.sidebarPadding;

      await this.addCommentBox(
        page,
        commentX,
        commentYOffset,
        highlight,
        font,
        boldFont,
        color,
      );

      commentYOffset -=
        this.calculateCommentHeight(highlight.comment, font) +
        this.config.commentGap;

      if (commentYOffset < this.config.sidebarBottomMargin) {
        commentYOffset = height - this.config.sidebarTopMargin;
      }
    }

    this.addLegend(page, font);
  }

  /**
   * Add a comment box with AI feedback
   */
  private async addCommentBox(
    page: PDFPage,
    x: number,
    y: number,
    highlight: TextHighlight,
    font: PDFFont,
    boldFont: PDFFont,
    color: ColorRGB,
  ): Promise<void> {
    const commentHeight = this.calculateCommentHeight(highlight.comment, font);
    const boxHeight = commentHeight + this.config.commentPadding * 2 + 25;

    page.drawRectangle({
      x: x,
      y: y - boxHeight,
      width: this.config.commentWidth,
      height: boxHeight,
      color: rgb(1, 1, 1),
      borderColor: rgb(color.r, color.g, color.b),
      borderWidth: 2,
    });

    page.drawRectangle({
      x: x,
      y: y - 25,
      width: this.config.commentWidth,
      height: 25,
      color: rgb(color.r, color.g, color.b),
      opacity: 0.2,
    });

    const levelText = this.getLevelText(highlight.level);
    const icon = this.getLevelIcon(highlight.level);
    this.safeDrawText(page, `${icon} ${levelText}`, {
      x: x + this.config.commentPadding,
      y: y - 18,
      size: 9,
      font: boldFont,
      color: rgb(color.r * 0.7, color.g * 0.7, color.b * 0.7),
    });

    if (highlight.criterionId) {
      this.safeDrawText(page, highlight.criterionId, {
        x: x + this.config.commentWidth - 60,
        y: y - 18,
        size: 7,
        font: font,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    const wrappedLines = this.wrapText(
      highlight.comment || "",
      this.config.commentWidth - this.config.commentPadding * 2,
      font,
      this.config.fontSize,
    );

    let textY = y - 35;
    for (const line of wrappedLines) {
      this.safeDrawText(page, line, {
        x: x + this.config.commentPadding,
        y: textY,
        size: this.config.fontSize,
        font: font,
        color: rgb(0.2, 0.2, 0.2),
      });
      textY -= 12;
    }

    if (highlight.text && highlight.text.length > 0) {
      const snippet =
        highlight.text.length > 50
          ? highlight.text.slice(0, 50) + "..."
          : highlight.text;
      this.safeDrawText(page, `"${snippet}"`, {
        x: x + this.config.commentPadding,
        y: textY - 5,
        size: 8,
        font: font,
        color: rgb(0.4, 0.4, 0.4),
        opacity: 0.8,
      });
    }
  }

  /**
   * Add a summary page at the end with overall feedback
   */
  private async addSummaryPage(
    pdfDocument: PDFDocument,
    highlighting: FileHighlighting,
    font: PDFFont,
    boldFont: PDFFont,
  ): Promise<void> {
    const summaryPage = pdfDocument.addPage();
    const { width, height } = summaryPage.getSize();

    summaryPage.drawRectangle({
      x: 0,
      y: height - 80,
      width: width,
      height: 80,
      color: rgb(0.95, 0.95, 1),
    });

    this.safeDrawText(summaryPage, "GRADING SUMMARY", {
      x: 50,
      y: height - 40,
      size: 20,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.6),
    });

    let correctCount = 0;
    let partialCount = 0;
    let incorrectCount = 0;
    let totalScore = 0;

    for (const pageData of Object.values(highlighting.pages)) {
      totalScore += pageData.correctnessScore;

      for (const h of pageData.highlights) {
        switch (h.level) {
          case HighlightLevel.CORRECT: {
            correctCount++;
            break;
          }
          case HighlightLevel.PARTIAL: {
            partialCount++;
            break;
          }
          case HighlightLevel.INCORRECT: {
            incorrectCount++;
            break;
          }
          // No default
        }
      }
    }

    const pageCount = Object.keys(highlighting.pages).length;
    const avgScore = pageCount > 0 ? totalScore / pageCount : 0;

    let yPos = height - 120;

    this.safeDrawText(summaryPage, "Overall Correctness Score:", {
      x: 50,
      y: yPos,
      size: 14,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.2),
    });

    this.safeDrawText(summaryPage, `${Math.round(avgScore)}%`, {
      x: 250,
      y: yPos,
      size: 20,
      font: boldFont,
      color:
        avgScore >= 90
          ? rgb(0.2, 0.7, 0.2)
          : avgScore >= 70
            ? rgb(0.8, 0.7, 0.2)
            : rgb(0.8, 0.2, 0.2),
    });

    yPos -= 40;

    this.safeDrawText(summaryPage, "Feedback Breakdown:", {
      x: 50,
      y: yPos,
      size: 12,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.2),
    });

    yPos -= 25;

    this.safeDrawText(summaryPage, `[+] Correct: ${correctCount}`, {
      x: 70,
      y: yPos,
      size: 11,
      font: font,
      color: rgb(0.2, 0.7, 0.2),
    });

    yPos -= 20;

    this.safeDrawText(summaryPage, `[~] Partially Correct: ${partialCount}`, {
      x: 70,
      y: yPos,
      size: 11,
      font: font,
      color: rgb(0.8, 0.6, 0.2),
    });

    yPos -= 20;

    this.safeDrawText(summaryPage, `[X] Needs Improvement: ${incorrectCount}`, {
      x: 70,
      y: yPos,
      size: 11,
      font: font,
      color: rgb(0.8, 0.2, 0.2),
    });

    yPos -= 40;

    this.safeDrawText(summaryPage, "Detailed Feedback Summary:", {
      x: 50,
      y: yPos,
      size: 12,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.2),
    });

    yPos -= 25;

    const criterionMap = new Map<
      string,
      {
        criterionId: string;
        rubricQuestion: string;
        level: HighlightLevel;
        points: string;
        status: string;
        pages: number[];
      }
    >();

    for (const [pageNumberString, pageData] of Object.entries(
      highlighting.pages,
    )) {
      const pageNumber = Number(pageNumberString);
      const typedPageData = pageData;

      for (const highlight of typedPageData.highlights) {
        const commentMatch = highlight.comment?.match(
          /^\[(.*?)]\s*\*\*(.*?)\*\*\s*\((.*?)\):\s*([\S\s]*)/,
        );

        if (commentMatch && highlight.criterionId) {
          const [, status, criterion, points] = commentMatch;
          const criterionId = highlight.criterionId;

          if (!criterionMap.has(criterionId)) {
            criterionMap.set(criterionId, {
              criterionId,
              rubricQuestion: criterion,
              level: highlight.level,
              points,
              status,
              pages: [],
            });
          }

          const criterionData = criterionMap.get(criterionId);
          if (criterionData && !criterionData.pages.includes(pageNumber)) {
            criterionData.pages.push(pageNumber);
          }
        }
      }
    }

    const sortedCriteria = [...criterionMap.values()].sort((a, b) => {
      const levelOrder = {
        [HighlightLevel.CORRECT]: 0,
        [HighlightLevel.PARTIAL]: 1,
        [HighlightLevel.INCORRECT]: 2,
      };
      return (levelOrder[a.level] || 3) - (levelOrder[b.level] || 3);
    });

    let currentPage = summaryPage;

    for (const criterion of sortedCriteria) {
      if (yPos < 100) {
        currentPage = pdfDocument.addPage();
        const { height: newHeight, width: newWidth } = currentPage.getSize();
        yPos = newHeight - 50;

        currentPage.drawRectangle({
          x: 0,
          y: newHeight - 60,
          width: newWidth,
          height: 60,
          color: rgb(0.95, 0.95, 1),
        });

        this.safeDrawText(currentPage, "GRADING SUMMARY (continued)", {
          x: 50,
          y: newHeight - 35,
          size: 16,
          font: boldFont,
          color: rgb(0.2, 0.2, 0.6),
        });

        yPos = newHeight - 80;
      }

      const levelColor =
        criterion.level === HighlightLevel.CORRECT
          ? rgb(0.2, 0.7, 0.2)
          : criterion.level === HighlightLevel.PARTIAL
            ? rgb(0.8, 0.6, 0.2)
            : rgb(0.8, 0.2, 0.2);

      const pagesText =
        criterion.pages.length > 1
          ? `Pages ${criterion.pages.map((p) => p + 1).join(", ")}`
          : `Page ${criterion.pages[0] + 1}`;

      this.safeDrawText(
        currentPage,
        `${pagesText}: [${criterion.status}] ${criterion.points}`,
        {
          x: 70,
          y: yPos,
          size: 10,
          font: boldFont,
          color: levelColor,
        },
      );

      yPos -= 15;

      const maxWidth = width - 140;
      const criterionLines = this.wrapText(
        criterion.rubricQuestion,
        maxWidth,
        font,
        9,
      );

      for (const line of criterionLines) {
        if (yPos < 50) break;
        this.safeDrawText(currentPage, `  ${line}`, {
          x: 70,
          y: yPos,
          size: 9,
          font: font,
          color: rgb(0.3, 0.3, 0.3),
        });
        yPos -= 12;
      }

      yPos -= 8;
    }

    if (yPos > 200) {
      yPos -= 30;
    }

    if (yPos < 150) {
      currentPage = pdfDocument.addPage();
      const { height: newHeight } = currentPage.getSize();
      yPos = newHeight - 50;
    }

    this.safeDrawText(currentPage, "How to Use This Feedback:", {
      x: 50,
      y: yPos,
      size: 12,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.2),
    });

    yPos -= 25;

    const instructions = [
      "• Review the highlighted sections in your submission",
      "• Comments in the margins explain each highlight",
      "• Green highlights indicate correct content",
      "• Yellow highlights show partially correct content",
      "• Red highlights indicate areas needing improvement",
      "• Use this feedback to improve your understanding",
    ];

    for (const instruction of instructions) {
      this.safeDrawText(currentPage, instruction, {
        x: 70,
        y: yPos,
        size: 10,
        font: font,
        color: rgb(0.3, 0.3, 0.3),
      });
      yPos -= 18;
    }

    this.safeDrawText(currentPage, "Generated by AI Grading System", {
      x: 50,
      y: 30,
      size: 8,
      font: font,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  /**
   * Add a legend at the bottom of the page
   */
  private addLegend(page: PDFPage, font: PDFFont): void {
    const legendY = 30;

    page.drawRectangle({
      x: 20,
      y: legendY - 5,
      width: 15,
      height: 15,
      color: rgb(0.2, 0.8, 0.2),
      opacity: 0.3,
    });
    this.safeDrawText(page, "Correct", {
      x: 40,
      y: legendY,
      size: 8,
      font: font,
      color: rgb(0.3, 0.3, 0.3),
    });

    page.drawRectangle({
      x: 100,
      y: legendY - 5,
      width: 15,
      height: 15,
      color: rgb(1, 0.8, 0.2),
      opacity: 0.3,
    });
    this.safeDrawText(page, "Partial", {
      x: 120,
      y: legendY,
      size: 8,
      font: font,
      color: rgb(0.3, 0.3, 0.3),
    });

    page.drawRectangle({
      x: 180,
      y: legendY - 5,
      width: 15,
      height: 15,
      color: rgb(1, 0.2, 0.2),
      opacity: 0.3,
    });
    this.safeDrawText(page, "Needs Work", {
      x: 200,
      y: legendY,
      size: 8,
      font: font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }

  /**
   * Get color RGB values based on highlight level
   */
  private getHighlightColor(level: HighlightLevel): ColorRGB {
    switch (level) {
      case HighlightLevel.CORRECT: {
        return { r: 0.2, g: 0.8, b: 0.2 };
      }
      case HighlightLevel.PARTIAL: {
        return { r: 1, g: 0.8, b: 0.2 };
      }
      case HighlightLevel.INCORRECT: {
        return { r: 1, g: 0.2, b: 0.2 };
      }
      default: {
        return { r: 0.5, g: 0.5, b: 0.5 };
      }
    }
  }

  /**
   * Get human-readable text for highlight level
   */
  private getLevelText(level: HighlightLevel): string {
    switch (level) {
      case HighlightLevel.CORRECT: {
        return "CORRECT";
      }
      case HighlightLevel.PARTIAL: {
        return "PARTIAL";
      }
      case HighlightLevel.INCORRECT: {
        return "NEEDS WORK";
      }
      default: {
        return "NOTE";
      }
    }
  }

  /**
   * Get icon for highlight level (ASCII-safe for PDF WinAnsi encoding)
   */
  private getLevelIcon(level: HighlightLevel): string {
    switch (level) {
      case HighlightLevel.CORRECT: {
        return "[+]";
      }
      case HighlightLevel.PARTIAL: {
        return "[~]";
      }
      case HighlightLevel.INCORRECT: {
        return "[X]";
      }
      default: {
        return "[i]";
      }
    }
  }

  /**
   * Sanitize text to remove Unicode and control characters that WinAnsi encoding cannot handle
   * Uses strict whitelist approach to ensure PDF compatibility
   */
  private sanitizeTextForPdf(text: string): string {
    if (!text) return "";

    const textString = String(text);
    const controlCharsPattern = new RegExp(
      `[${String.fromCodePoint(0)}-${String.fromCodePoint(31)}${String.fromCodePoint(127)}-${String.fromCodePoint(159)}]`,
      "g",
    );

    let sanitized = textString
      .replaceAll("✓", "[+]")
      .replaceAll("✗", "[X]")
      .replaceAll("⚠", "[!]")
      .replaceAll("ℹ", "[i]")
      .replaceAll("•", "*")
      .replaceAll("–", "-")
      .replaceAll("—", "--")
      .replaceAll("'", "'")
      .replaceAll("'", "'")
      .replaceAll('"', '"')
      .replaceAll('"', '"')
      .replaceAll("…", "...")
      .replaceAll("\u00A0", " ");

    sanitized = sanitized.replaceAll(controlCharsPattern, " ");

    sanitized = sanitized.replaceAll(/[^ -~]/g, "");

    sanitized = sanitized.replaceAll(/\s+/g, " ");

    return sanitized.trim();
  }

  /**
   * ULTIMATE SAFE drawText wrapper - ensures NO text can reach PDF without sanitization
   * This is a defensive wrapper that catches all edge cases
   */
  private safeDrawText(
    page: PDFPage,
    text: string,
    options: Parameters<PDFPage["drawText"]>[1],
  ): void {
    try {
      const safeText = this.sanitizeTextForPdf(text || "");

      if (!safeText || safeText.length === 0) {
        return;
      }

      page.drawText(safeText, options);
    } catch (error) {
      this.logger.warn(
        `Failed to draw text, skipping: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Wrap text to fit within a specified width
   */
  private wrapText(
    text: string,
    maxWidth: number,
    font: PDFFont,
    fontSize: number,
  ): string[] {
    const safeText = this.sanitizeTextForPdf(text);
    if (!safeText) {
      return [];
    }

    const words = safeText.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Calculate the height needed for a comment box
   */
  private calculateCommentHeight(text: string, font: PDFFont): number {
    const lines = this.wrapText(
      text,
      this.config.commentWidth - this.config.commentPadding * 2,
      font,
      this.config.fontSize,
    );
    return lines.length * 12 + 20;
  }

  private normalizePdfTextItems(
    items: TextContent["items"],
  ): SimplifiedPdfItem[] {
    return items
      .filter((item): item is PdfJsTextItem => {
        const candidate = item as Partial<PdfJsTextItem>;
        return (
          typeof candidate?.str === "string" &&
          Array.isArray(candidate.transform) &&
          typeof candidate.width === "number" &&
          typeof candidate.height === "number"
        );
      })
      .map((item) => ({
        text: item.str,
        transform: item.transform.map(Number),
        width: item.width,
        height: item.height,
      }))
      .filter(
        (item) => item.transform.length >= 6 && item.text.trim().length > 0,
      );
  }

  /**
   * Extract block-level text boxes per page using PDF.js.
   * These blocks align with the IDs used by structured extraction: `p{page}b{index}`.
   */
  private async extractBlocksByPage(
    originalPdfBuffer: Buffer,
    pagesToAnnotate: number[],
  ): Promise<Map<number, Map<string, ExtractedBlock>>> {
    const blocksByPage = new Map<number, Map<string, ExtractedBlock>>();

    if (!pagesToAnnotate || pagesToAnnotate.length === 0) {
      return blocksByPage;
    }

    try {
      const uint8Array = new Uint8Array(originalPdfBuffer);
      const loadingTask = pdfjs.getDocument({
        data: uint8Array,
        useSystemFonts: true,
        standardFontDataUrl: null,
      });

      const pdfDocument: PDFDocumentProxy = await loadingTask.promise;
      const numberPages: number = pdfDocument.numPages ?? 0;

      for (const pageNumber of pagesToAnnotate) {
        if (pageNumber < 1 || pageNumber > numberPages) {
          continue;
        }

        try {
          const page: PDFPageProxy = await pdfDocument.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const blocks = this.groupPdfJsTextItemsIntoBlocks(
            this.normalizePdfTextItems(textContent.items),
            pageNumber,
          );

          const blocksById = new Map<string, ExtractedBlock>();
          for (const block of blocks) {
            blocksById.set(block.blockId, block);
          }

          blocksByPage.set(pageNumber, blocksById);
        } catch (error) {
          this.logger.warn(
            `Failed to extract PDF blocks for page ${pageNumber}, continuing without content highlights`,
            error,
          );
          blocksByPage.set(pageNumber, new Map());
        }
      }

      try {
        await loadingTask.destroy();
      } catch (destroyError) {
        this.logger.debug(
          "Failed to destroy PDF loading task cleanly",
          destroyError,
        );
      }
    } catch (error) {
      this.logger.warn(
        "Failed to extract PDF blocks, continuing without content highlights",
        error,
      );
    }

    return blocksByPage;
  }

  private groupPdfJsTextItemsIntoBlocks(
    items: SimplifiedPdfItem[],
    pageNumber: number,
  ): ExtractedBlock[] {
    if (!items || items.length === 0) {
      return [];
    }

    const sortedItems = [...items].sort((a, b) => {
      const yA = a.transform[5];
      const yB = b.transform[5];
      if (Math.abs(yA - yB) < 2) {
        return a.transform[4] - b.transform[4];
      }
      return yB - yA;
    });

    const blocks: ExtractedBlock[] = [];
    let currentBlock: {
      items: SimplifiedPdfItem[];
      minY: number;
      maxY: number;
      minX: number;
      maxX: number;
    } | null = null;

    for (const item of sortedItems) {
      const x = item.transform[4];
      const y = item.transform[5];
      const itemHeight = item.height && item.height > 0 ? item.height : 12;
      const itemWidth = item.width && item.width > 0 ? item.width : 0;

      const startNewBlock =
        !currentBlock ||
        Math.abs(y - currentBlock.maxY) > itemHeight * 1.5 ||
        (x < currentBlock.minX - 50 && Math.abs(y - currentBlock.maxY) > 5);

      if (startNewBlock) {
        if (currentBlock && currentBlock.items.length > 0) {
          blocks.push(
            this.buildExtractedBlock(
              currentBlock.items,
              pageNumber,
              blocks.length,
              {
                minX: currentBlock.minX,
                minY: currentBlock.minY,
                maxX: currentBlock.maxX,
                maxY: currentBlock.maxY,
              },
            ),
          );
        }

        currentBlock = {
          items: [item],
          minY: y,
          maxY: y + itemHeight,
          minX: x,
          maxX: x + itemWidth,
        };
      } else {
        currentBlock.items.push(item);
        currentBlock.minY = Math.min(currentBlock.minY, y);
        currentBlock.maxY = Math.max(currentBlock.maxY, y + itemHeight);
        currentBlock.minX = Math.min(currentBlock.minX, x);
        currentBlock.maxX = Math.max(currentBlock.maxX, x + itemWidth);
      }
    }

    if (currentBlock && currentBlock.items.length > 0) {
      blocks.push(
        this.buildExtractedBlock(
          currentBlock.items,
          pageNumber,
          blocks.length,
          {
            minX: currentBlock.minX,
            minY: currentBlock.minY,
            maxX: currentBlock.maxX,
            maxY: currentBlock.maxY,
          },
        ),
      );
    }

    return blocks;
  }

  private buildExtractedBlock(
    items: SimplifiedPdfItem[],
    pageNumber: number,
    blockIndex: number,
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
  ): ExtractedBlock {
    const blockId = `p${pageNumber}b${blockIndex}`;

    const extractedItems: ExtractedTextItem[] = [];
    let blockText = "";

    for (const item of items) {
      const normalizedText = item.text.trim();
      if (!normalizedText) continue;

      const x = item.transform[4];
      const y = item.transform[5];
      const itemHeight = item.height > 0 ? item.height : 12;
      const itemWidth = item.width > 0 ? item.width : 0;

      if (blockText.length > 0) {
        blockText += " ";
      }

      const start = blockText.length;
      blockText += normalizedText;
      const end = blockText.length;

      extractedItems.push({
        text: normalizedText,
        start,
        end,
        bbox: {
          x,
          y,
          width: itemWidth,
          height: itemHeight,
        },
      });
    }

    return {
      blockId,
      text: blockText,
      bbox: {
        x: bbox.minX,
        y: bbox.minY,
        width: Math.max(0, bbox.maxX - bbox.minX),
        height: Math.max(0, bbox.maxY - bbox.minY),
      },
      items: extractedItems,
    };
  }

  private resolveHighlightRects(
    highlight: TextHighlight,
    pageHighlighting: ResponseHighlighting,
    blocksById?: Map<string, ExtractedBlock>,
  ): BBox[] {
    if (!blocksById || blocksById.size === 0) {
      return [];
    }

    const candidateIds = [
      highlight.evidenceId,
      highlight.criterionId,
      pageHighlighting.blockId,
    ].filter(Boolean);

    let block: ExtractedBlock | undefined;
    let blockId: string | undefined;

    for (const candidate of candidateIds) {
      const found = blocksById.get(candidate);
      if (found) {
        block = found;
        blockId = candidate;
        break;
      }
    }

    if (!block || !blockId) {
      return [];
    }

    if (highlight.text && highlight.text.trim().length > 0) {
      const startInBlock = block.text.indexOf(highlight.text);
      if (startInBlock !== -1) {
        const endInBlock = startInBlock + highlight.text.length;
        const itemRects = block.items
          .filter((item) => item.end > startInBlock && item.start < endInBlock)
          .map((item) => item.bbox)
          .filter((bbox) => bbox.width > 0 && bbox.height > 0);

        if (itemRects.length > 0) {
          return itemRects;
        }
      }
    }

    if (block.bbox.width > 0 && block.bbox.height > 0) {
      return [block.bbox];
    }

    return [];
  }

  private mergeRectsByLine(rects: BBox[]): BBox[] {
    if (rects.length <= 1) {
      return rects;
    }

    const yQuantum = 2;
    const groups = new Map<number, BBox[]>();

    for (const rect of rects) {
      const key = Math.round(rect.y / yQuantum);
      const group = groups.get(key) ?? [];
      group.push(rect);
      groups.set(key, group);
    }

    const merged: BBox[] = [];
    for (const groupRects of groups.values()) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      for (const rect of groupRects) {
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
      }

      if (
        Number.isFinite(minX) &&
        Number.isFinite(minY) &&
        Number.isFinite(maxX) &&
        Number.isFinite(maxY)
      ) {
        merged.push({
          x: minX,
          y: minY,
          width: Math.max(0, maxX - minX),
          height: Math.max(0, maxY - minY),
        });
      }
    }

    return merged.sort((a, b) => b.y - a.y || a.x - b.x);
  }

  private clampRectToPage(
    rect: BBox,
    maxWidth: number,
    maxHeight: number,
  ): BBox | null {
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const width = Math.min(rect.width, maxWidth - x);
    const height = Math.min(rect.height, maxHeight - y);

    if (width <= 0 || height <= 0) {
      return null;
    }

    return { x, y, width, height };
  }

  private padRect(
    rect: BBox,
    padding: number,
    maxWidth: number,
    maxHeight: number,
  ): BBox | null {
    const x = rect.x - padding;
    const y = rect.y - padding;
    const width = rect.width + padding * 2;
    const height = rect.height + padding * 2;

    return this.clampRectToPage({ x, y, width, height }, maxWidth, maxHeight);
  }
}
