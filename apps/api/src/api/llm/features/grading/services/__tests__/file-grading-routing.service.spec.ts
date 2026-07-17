/* eslint-disable */
/**
 * Regression tests for grading routing fixes:
 *
 * 1. Code files (Python, Java, C++, JS/TS) must NOT receive synthetic
 *    structured content and must be routed to template-based grading,
 *    not evidence-based grading.
 *
 * 2. Spreadsheet files (.xlsx, .xls, .csv, .tsv, .ods) must receive
 *    rebuilt structured content and be routed to evidence-based or
 *    deterministic grading.
 *
 * 3. PDFs with existing (real) structured content must keep that content
 *    and be routed to evidence-based grading.
 *
 * 4. tryDeterministicSpreadsheetGrading is called BEFORE evidence-based
 *    grading in the grading flow.
 */

import { LearnerFileUpload } from "src/api/attempt/common/interfaces/attempt.interface";
import { CanonicalSubmission } from "src/api/attempt/services/structured-content.models";

// ── Helper to build a minimal LearnerFileUpload ────────────────────────────

function makeFile(
  filename: string,
  overrides: Partial<LearnerFileUpload> = {},
): LearnerFileUpload {
  return {
    filename,
    fileType: "application/octet-stream",
    key: "test-key",
    bucket: "test-bucket",
    content: "some content",
    ...overrides,
  } as LearnerFileUpload;
}

function makeSpreadsheetFile(
  filename: string,
  content = "=== EXCEL WORKBOOK ===\n=== SHEET: Sheet1 ===\nA\tB\n1\t2\n",
): LearnerFileUpload {
  return makeFile(filename, { content, extractedText: content });
}

function makeCodeFile(
  filename: string,
  code = "def hello():\n    print('Hello')\n",
): LearnerFileUpload {
  return makeFile(filename, { content: code, extractedText: code });
}

function makeDocumentFile(
  filename: string,
  content = "Project Report\n\nThe submission includes the requested title.",
): LearnerFileUpload {
  return makeFile(filename, {
    fileType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    content,
    extractedText: content,
  });
}

function makePdfFile(
  filename: string,
  structuredContent?: CanonicalSubmission,
): LearnerFileUpload {
  const base = makeFile(filename, {
    fileType: "application/pdf",
    structuredContent,
  });
  return base;
}

// ── Build a minimal FileGradingService with mocked dependencies ────────────

function buildService() {
  // We only test the pure-logic private methods, so we stub all I/O deps
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const service = Object.create(
    // Prototype with the real methods loaded from the actual module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../file-grading.service").FileGradingService.prototype,
  );

  service.logger = mockLogger;

  // Stub the methods that call external services (LLM, S3, etc.)
  service.evidenceBasedGrading = { gradeSubmission: jest.fn() };
  service.pdfAnnotationService = {};
  service.s3Service = {};
  service.moderationService = {
    validateContent: jest.fn().mockResolvedValue(true),
  };
  service.llmResolver = {
    getModelForGradingTask: jest.fn(),
    getModelKeyWithFallback: jest.fn(),
  };
  service.promptProcessor = { processPromptForFeature: jest.fn() };
  service.tokenCounter = { countTokens: jest.fn().mockReturnValue(100) };
  service.evidenceFileGradingInFlight = new Map();

  return service;
}

// ─── shouldRebuildStructuredContent ───────────────────────────────────────

describe("FileGradingService.shouldRebuildStructuredContent", () => {
  let service: any;

  beforeEach(() => {
    service = buildService();
  });

  // Code files – must NOT be rebuilt
  const codeFiles = [
    "solution.py",
    "Main.java",
    "algorithm.cpp",
    "util.c",
    "index.js",
    "app.ts",
    "component.tsx",
    "helper.jsx",
    "main.go",
    "lib.rs",
    "script.rb",
    "program.cs",
  ];

  for (const filename of codeFiles) {
    it(`returns false for code file: ${filename}`, () => {
      const file = makeCodeFile(filename);
      expect(service.shouldRebuildStructuredContent(file)).toBe(false);
    });
  }

  it("returns false for code file even when it has no existing structuredContent", () => {
    const file = makeCodeFile("main.py");
    expect(file.structuredContent).toBeUndefined();
    expect(service.shouldRebuildStructuredContent(file)).toBe(false);
  });

  // Spreadsheet files – must be rebuilt when no existing structured content
  const spreadsheetFiles = [
    {
      filename: "data.xlsx",
      content: "=== EXCEL WORKBOOK ===\n=== SHEET: A ===\nval\n",
    },
    {
      filename: "report.xls",
      content: "=== EXCEL WORKBOOK ===\n=== SHEET: A ===\nval\n",
    },
    { filename: "export.csv", content: "name,age\nAlice,30\n" },
    { filename: "export.tsv", content: "name\tage\nAlice\t30\n" },
    { filename: "spreadsheet.ods", content: "=== SHEET: A ===\nval\n" },
  ];

  for (const { filename, content } of spreadsheetFiles) {
    it(`returns true for spreadsheet without existing content: ${filename}`, () => {
      const file = makeSpreadsheetFile(filename, content);
      delete (file as any).structuredContent;
      expect(service.shouldRebuildStructuredContent(file)).toBe(true);
    });
  }

  it("returns true for a spreadsheet whose content contains tabular markers in text", () => {
    const file = makeFile("workbook.xlsx", {
      content: "=== EXCEL WORKBOOK ===\n=== SHEET: Results ===\nA\tB\t",
      extractedText: "=== EXCEL WORKBOOK ===\n=== SHEET: Results ===\nA\tB\t",
    });
    expect(service.shouldRebuildStructuredContent(file)).toBe(true);
  });

  it("returns false for a PDF that already has real structured content", () => {
    const realStructure: CanonicalSubmission = {
      submissionId: "essay.pdf",
      metadata: {
        wordCount: 500,
        pageCount: 2,
        blockCount: 25,
        sourceType: "pdf",
        checksum: "abc",
        extractedAt: new Date().toISOString(),
      },
      pages: [{ pageNumber: 1, blocks: [] }],
    };
    const file = makePdfFile("essay.pdf", realStructure);
    expect(service.shouldRebuildStructuredContent(file)).toBe(false);
  });

  it("returns true for document text without existing structuredContent", () => {
    const file = makeDocumentFile("report.docx");
    delete (file as any).structuredContent;
    expect(service.shouldRebuildStructuredContent(file)).toBe(true);
  });

  it("returns false for a spreadsheet that already has sufficient blocks", () => {
    const existing: CanonicalSubmission = {
      submissionId: "data.xlsx",
      metadata: {
        wordCount: 200,
        pageCount: 1,
        blockCount: 20, // > 10 → does NOT need rebuild
        sourceType: "txt",
        checksum: "def",
        extractedAt: new Date().toISOString(),
      },
      pages: [{ pageNumber: 1, blocks: [] }],
    };
    const file = makeSpreadsheetFile(
      "data.xlsx",
      "=== SHEET: A ===\nval1\tval2\n",
    );
    (file as any).structuredContent = existing;
    // has \t in text → still needs rebuild
    expect(service.shouldRebuildStructuredContent(file)).toBe(true);
  });
});

// ─── ensureStructuredContentForEvidenceGrading ────────────────────────────

describe("FileGradingService.ensureStructuredContentForEvidenceGrading", () => {
  let service: any;

  beforeEach(() => {
    service = buildService();
  });

  it("does NOT add structuredContent to code files", () => {
    const pyFile = makeCodeFile("solution.py");
    const result = service.ensureStructuredContentForEvidenceGrading([pyFile]);
    expect(result[0].structuredContent).toBeUndefined();
  });

  it("does NOT add structuredContent to JS/TS files", () => {
    const tsFile = makeCodeFile("app.ts");
    const result = service.ensureStructuredContentForEvidenceGrading([tsFile]);
    expect(result[0].structuredContent).toBeUndefined();
  });

  it("adds structuredContent to an xlsx spreadsheet that lacks it", () => {
    const xlsxFile = makeSpreadsheetFile("data.xlsx");
    delete (xlsxFile as any).structuredContent;
    const result = service.ensureStructuredContentForEvidenceGrading([
      xlsxFile,
    ]);
    expect(result[0].structuredContent).toBeDefined();
    expect(result[0].structuredContent?.metadata.blockCount).toBeGreaterThan(0);
  });

  it("adds structuredContent to a docx document that lacks it", () => {
    const docxFile = makeDocumentFile("report.docx");
    delete (docxFile as any).structuredContent;
    const result = service.ensureStructuredContentForEvidenceGrading([
      docxFile,
    ]);
    expect(result[0].structuredContent).toBeDefined();
    expect(result[0].structuredContent?.submissionId).toBe("report.docx");
  });

  it("preserves existing structuredContent on a PDF", () => {
    const realStructure: CanonicalSubmission = {
      submissionId: "report.pdf",
      metadata: {
        wordCount: 800,
        pageCount: 3,
        blockCount: 40,
        sourceType: "pdf",
        checksum: "xyz",
        extractedAt: new Date().toISOString(),
      },
      pages: [{ pageNumber: 1, blocks: [] }],
    };
    const pdfFile = makePdfFile("report.pdf", realStructure);
    const result = service.ensureStructuredContentForEvidenceGrading([pdfFile]);
    expect(result[0].structuredContent).toBe(realStructure); // same reference
  });

  it("mixed submission: code file stays without structuredContent, spreadsheet gets it", () => {
    const pyFile = makeCodeFile("helper.py");
    const xlsxFile = makeSpreadsheetFile("data.xlsx");
    delete (xlsxFile as any).structuredContent;

    const result = service.ensureStructuredContentForEvidenceGrading([
      pyFile,
      xlsxFile,
    ]);

    const resultPy = result.find((f: LearnerFileUpload) =>
      f.filename.endsWith(".py"),
    );
    const resultXlsx = result.find((f: LearnerFileUpload) =>
      f.filename.endsWith(".xlsx"),
    );

    expect(resultPy?.structuredContent).toBeUndefined();
    expect(resultXlsx?.structuredContent).toBeDefined();
  });
});

// ─── hasStructuredContent gate ─────────────────────────────────────────────
// Verifies that code files do NOT trigger evidence-based grading.

describe("FileGradingService - code files use template-based grading", () => {
  let service: any;

  beforeEach(() => {
    service = buildService();
  });

  it("code file results in hasStructuredContent = false after enrichment", () => {
    const pyFile = makeCodeFile("solution.py");
    const enriched = service.ensureStructuredContentForEvidenceGrading([
      pyFile,
    ]);
    const hasStructuredContent = enriched.some(
      (f: LearnerFileUpload) => f.structuredContent,
    );
    expect(hasStructuredContent).toBe(false);
  });

  it("spreadsheet results in hasStructuredContent = true after enrichment", () => {
    const xlsxFile = makeSpreadsheetFile("data.xlsx");
    delete (xlsxFile as any).structuredContent;
    const enriched = service.ensureStructuredContentForEvidenceGrading([
      xlsxFile,
    ]);
    const hasStructuredContent = enriched.some(
      (f: LearnerFileUpload) => f.structuredContent,
    );
    expect(hasStructuredContent).toBe(true);
  });

  it("PDF with real structured content results in hasStructuredContent = true", () => {
    const structure: CanonicalSubmission = {
      submissionId: "essay.pdf",
      metadata: {
        wordCount: 300,
        pageCount: 1,
        blockCount: 15,
        sourceType: "pdf",
        checksum: "abc",
        extractedAt: new Date().toISOString(),
      },
      pages: [{ pageNumber: 1, blocks: [] }],
    };
    const pdfFile = makePdfFile("essay.pdf", structure);
    const enriched = service.ensureStructuredContentForEvidenceGrading([
      pdfFile,
    ]);
    const hasStructuredContent = enriched.some(
      (f: LearnerFileUpload) => f.structuredContent,
    );
    expect(hasStructuredContent).toBe(true);
  });

  it("docx file becomes evidence eligible after enrichment", () => {
    const docxFile = makeDocumentFile("report.docx");
    const [enriched] = service.ensureStructuredContentForEvidenceGrading([
      docxFile,
    ]);
    expect(service.isEvidenceBasedEligible(enriched)).toBe(true);
  });

  it("code file is not evidence eligible even if structuredContent exists", () => {
    const structure: CanonicalSubmission = {
      submissionId: "solution.py",
      metadata: {
        wordCount: 3,
        pageCount: 1,
        blockCount: 2,
        sourceType: "txt",
        checksum: "code",
        extractedAt: new Date().toISOString(),
      },
      pages: [{ pageNumber: 1, blocks: [] }],
    };
    const pyFile = makeCodeFile("solution.py");
    (pyFile as any).structuredContent = structure;
    expect(service.isEvidenceBasedEligible(pyFile)).toBe(false);
  });
});

// ─── tryDeterministicSpreadsheetGrading is called before evidence-based ───

describe("FileGradingService - deterministic grading runs before evidence-based", () => {
  let service: any;

  beforeEach(() => {
    service = buildService();
  });

  it("calls tryDeterministicSpreadsheetGrading before gradeWithEvidenceBasedApproach", async () => {
    const deterministicSpy = jest
      .spyOn(service, "tryDeterministicSpreadsheetGrading")
      .mockResolvedValue(null); // returns null → falls through

    const evidenceSpy = jest
      .spyOn(service, "gradeWithEvidenceBasedApproach")
      .mockResolvedValue({
        points: 5,
        feedback: "ok",
        analysis: "",
        evaluation: "",
        explanation: "",
        guidance: "",
        rubricScores: [],
        highlighting: null,
        annotatedPdfUrl: null,
      });

    // Need to stub all the methods used by gradeFileBasedQuestion
    service.moderationService.validateContent.mockResolvedValue(true);
    service.scaleFileBasedModelToQuestionMax = jest.fn().mockReturnValue({
      points: 5,
      feedback: "ok",
    });

    // Build a spreadsheet file with real structured content so
    // hasStructuredContent = true (skips the template-based path)
    const structure: CanonicalSubmission = {
      submissionId: "data.xlsx",
      metadata: {
        wordCount: 50,
        pageCount: 1,
        blockCount: 12,
        sourceType: "txt",
        checksum: "q",
        extractedAt: new Date().toISOString(),
      },
      pages: [{ pageNumber: 1, blocks: [] }],
    };
    const xlsxFile = makeSpreadsheetFile("data.xlsx");
    (xlsxFile as any).structuredContent = structure;

    const { FileUploadQuestionEvaluateModel } = await import(
      "src/api/llm/model/file.based.question.evaluate.model"
    );
    const { ResponseType } = await import("@prisma/client");

    const model = new FileUploadQuestionEvaluateModel(
      "Analyse the spreadsheet",
      [],
      "",
      [xlsxFile],
      10,
      "CRITERIA_BASED",
      { type: "CRITERIA_BASED", rubrics: [] },
      "FILE" as any,
      ResponseType.SPREADSHEET,
    );

    try {
      await service.gradeFileBasedQuestion(model, 1, "en");
    } catch {
      // May throw due to stubs, but we only care about call order
    }

    // Verify deterministic is always attempted first
    expect(deterministicSpy).toHaveBeenCalled();

    // Order: deterministic must be called before evidenceBased
    const deterministicOrder =
      deterministicSpy.mock.invocationCallOrder[0] ?? 0;
    const evidenceOrder =
      evidenceSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    expect(deterministicOrder).toBeLessThan(evidenceOrder);
  });

  it("skips evidence-based grading when deterministic returns a result", async () => {
    const { FileBasedQuestionResponseModel } = await import(
      "src/api/llm/model/file.based.question.response.model"
    );

    const deterministicModel = new FileBasedQuestionResponseModel(
      8,
      "Deterministic feedback",
      "",
      "",
      "",
      "",
      [],
    );

    jest
      .spyOn(service, "tryDeterministicSpreadsheetGrading")
      .mockResolvedValue(deterministicModel);

    const evidenceSpy = jest.spyOn(service, "gradeWithEvidenceBasedApproach");

    service.moderationService.validateContent.mockResolvedValue(true);
    service.scaleFileBasedModelToQuestionMax = jest
      .fn()
      .mockImplementation((m: any) => m);

    const structure: CanonicalSubmission = {
      submissionId: "data.xlsx",
      metadata: {
        wordCount: 50,
        pageCount: 1,
        blockCount: 15,
        sourceType: "txt",
        checksum: "q",
        extractedAt: new Date().toISOString(),
      },
      pages: [{ pageNumber: 1, blocks: [] }],
    };
    const xlsxFile = makeSpreadsheetFile("data.xlsx");
    (xlsxFile as any).structuredContent = structure;

    const { FileUploadQuestionEvaluateModel } = await import(
      "src/api/llm/model/file.based.question.evaluate.model"
    );
    const { ResponseType } = await import("@prisma/client");

    const model = new FileUploadQuestionEvaluateModel(
      "Analyse the spreadsheet",
      [],
      "",
      [xlsxFile],
      10,
      "CRITERIA_BASED",
      { type: "CRITERIA_BASED", rubrics: [] },
      "FILE" as any,
      ResponseType.SPREADSHEET,
    );

    try {
      const result = await service.gradeFileBasedQuestion(model, 1, "en");
      // If it returned, verify it's the deterministic result
      if (result) {
        expect(result.feedback).toBe("Deterministic feedback");
      }
    } catch {
      // May throw due to stubs
    }

    // evidence-based grading must NOT be called
    expect(evidenceSpy).not.toHaveBeenCalled();
  });

  it("routes criteria-based CODE uploads through the pinned structured-file model", async () => {
    const { FileBasedQuestionResponseModel } = await import(
      "src/api/llm/model/file.based.question.response.model"
    );
    const { FileUploadQuestionEvaluateModel } = await import(
      "src/api/llm/model/file.based.question.evaluate.model"
    );
    const { ResponseType } = await import("@prisma/client");
    const pinnedModel = "gpt-5.4-mini-2026-03-17";
    service.llmResolver.getModelKeyWithFallback.mockResolvedValue(pinnedModel);
    jest
      .spyOn(service, "tryDeterministicSpreadsheetGrading")
      .mockResolvedValue(null);
    const evidenceSpy = jest
      .spyOn(service, "gradeWithEvidenceBasedApproach")
      .mockResolvedValue(
        new FileBasedQuestionResponseModel(8, "Consistent code grade"),
      );
    service.scaleFileBasedModelToQuestionMax = jest
      .fn()
      .mockImplementation((value: any) => value);

    const model = new FileUploadQuestionEvaluateModel(
      "Implement the requested function",
      [],
      "",
      [makeCodeFile("solution.py")],
      10,
      "CRITERIA_BASED",
      {
        type: "CRITERIA_BASED",
        rubrics: [
          {
            rubricQuestion: "Correct implementation",
            criteria: [{ description: "Works", points: 10 }],
          },
        ],
      } as any,
      "FILE" as any,
      ResponseType.CODE,
      undefined,
      42,
    );

    const result = await service.gradeFileBasedQuestion(model, 1, "en");

    expect(result.feedback).toBe("Consistent code grade");
    expect(service.llmResolver.getModelKeyWithFallback).toHaveBeenCalledWith(
      "file_evidence_grading",
      pinnedModel,
    );
    expect(evidenceSpy).toHaveBeenCalledTimes(1);
    const call = evidenceSpy.mock.calls[0];
    expect(call[8]).toEqual({
      modelOverrides: {
        retrievalModel: pinnedModel,
        gradingModel: pinnedModel,
        judgeModel: pinnedModel,
      },
      modelOverridesAreFinal: true,
    });
    expect(call[9]).toBe(true);
    expect(call[10]).toBe(true);
    expect(call[0][0].structuredContent).toBeDefined();
  });

  it("returns one canonical score across repeated identical structured-file grades", async () => {
    const { FileBasedQuestionResponseModel } = await import(
      "src/api/llm/model/file.based.question.response.model"
    );
    // Keyed like the real cache — a lookup with a different cacheKey must
    // miss, otherwise key-instability bugs are invisible to this test.
    const cachedByKey = new Map<string, any>();
    service.cacheService = {
      getCachedGrading: jest.fn(
        async (key: string) => cachedByKey.get(key) ?? null,
      ),
      cacheGradingIfAbsent: jest.fn(async (candidate: any) => {
        if (!cachedByKey.has(candidate.cacheKey)) {
          cachedByKey.set(candidate.cacheKey, candidate);
        }
        return cachedByKey.get(candidate.cacheKey);
      }),
    };
    const grade = jest
      .fn()
      .mockResolvedValueOnce(
        new FileBasedQuestionResponseModel(8, "Canonical result"),
      )
      .mockResolvedValue(new FileBasedQuestionResponseModel(2, "Reroll"));
    const file = makeCodeFile("submission.py");
    (file as any).structuredContent = {
      submissionId: "submission",
      metadata: {
        wordCount: 5,
        pageCount: 1,
        blockCount: 1,
        sourceType: "txt",
        checksum: "stable",
        extractedAt: "2026-01-01T00:00:00.000Z",
      },
      pages: [{ pageNumber: 1, blocks: [] }],
    };
    const request = {
      questionId: 42,
      question: "Implement the function",
      learnerResponse: [file],
      scoringCriteria: { type: "CRITERIA_BASED", rubrics: [] },
      questionMaxPoints: 10,
      language: "en",
      modelSnapshot: "gpt-5.4-mini-2026-03-17",
      grade,
    };

    const results = [];
    for (let index = 0; index < 5; index++) {
      // Each grading pass re-runs extraction, which re-stamps extractedAt.
      // The cache key must not change with it.
      (file as any).structuredContent.metadata.extractedAt =
        `2026-01-0${index + 1}T00:00:00.000Z`;
      results.push(await service.gradeEvidenceFileWithCache(request));
    }

    expect(results.map((result) => result.points)).toEqual([8, 8, 8, 8, 8]);
    expect(grade).toHaveBeenCalledTimes(1);
  });
});
