import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";
import { Logger } from "@nestjs/common";
import {
  FileHighlighting,
  HighlightLevel,
  ResponseHighlighting,
  TextHighlight,
} from "../../llm/model/highlighting.model";
import { PdfAnnotationService } from "./pdf-annotation.service";

const loadFixturePdfBuffer = async (): Promise<Buffer> => {
  const candidates = [
    path.resolve(process.cwd(), "../../test_files/Final PPT with answers.pdf"),
    path.resolve(process.cwd(), "../test_files/Final PPT with answers.pdf"),
    path.resolve(process.cwd(), "test_files/Final PPT with answers.pdf"),
  ];

  for (const candidate of candidates) {
    try {
      const buffer = await fs.readFile(candidate);
      return buffer;
    } catch (error) {
      // Continue searching other candidate locations
      console.debug("PDF fixture not found at", candidate, error);
    }
  }

  // Fallback: generate a small PDF so the test still validates the annotation flow
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const { height } = page.getSize();
  page.drawText("Generated test PDF", { x: 50, y: height - 80, size: 24 });
  page.drawText("Used when fixture is unavailable.", {
    x: 50,
    y: height - 110,
    size: 12,
  });
  const bytes = await document.save();
  return Buffer.from(bytes);
};

describe("PdfAnnotationService", () => {
  let service: PdfAnnotationService;

  beforeEach(() => {
    jest.setTimeout(30_000);
    service = new PdfAnnotationService();
    const loggerMock: Pick<Logger, "log" | "debug" | "warn" | "error"> = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    (service as unknown as { logger: typeof loggerMock }).logger = loggerMock;
  });

  it("annotates the fixture PDF without WinAnsi encoding errors (e.g. newlines in comments)", async () => {
    const originalPdfBuffer = await loadFixturePdfBuffer();
    const originalDocument = await PDFDocument.load(originalPdfBuffer);

    const highlight: TextHighlight = {
      start: 0,
      end: 30,
      text: "Reducing wait times\nresource allocation — “smart quotes” • ✓",
      level: HighlightLevel.PARTIAL,
      comment:
        "Reducing wait times\nresource allocation between stakeholders — add specific examples • ✓",
      criterionId: "p4b4",
      evidenceId: "evidence-1",
    };

    const pageHighlighting: ResponseHighlighting = {
      originalText: "",
      highlights: [highlight],
      correctnessScore: 75,
      responseType: "file",
      pageNumber: 1,
      blockId: "p4b4",
    };

    const highlighting: FileHighlighting = {
      filename: "Final PPT with answers.pdf",
      pages: new Map<number, ResponseHighlighting>([[1, pageHighlighting]]),
      blockHighlights: new Map<string, TextHighlight[]>([
        ["p4b4", [highlight]],
      ]),
    };

    const annotatedPdfBuffer = await service.annotatePdf(
      originalPdfBuffer,
      highlighting,
      "Test Student\nName",
    );

    expect(annotatedPdfBuffer).toBeInstanceOf(Buffer);
    expect(annotatedPdfBuffer.length).toBeGreaterThan(0);

    const annotatedDocument = await PDFDocument.load(annotatedPdfBuffer);
    expect(annotatedDocument.getPageCount()).toBe(
      originalDocument.getPageCount() + 1,
    );
  });
});
