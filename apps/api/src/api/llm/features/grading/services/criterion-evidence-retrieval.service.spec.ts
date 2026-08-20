/* eslint-disable */
import {
  ExtractedChunk,
  RubricCriterion,
} from "../types/criterion-evidence.types";
import { ChunkIndex } from "./chunk-index.service";
import { CriterionEvidenceRetrievalService } from "./criterion-evidence-retrieval.service";

/** Helper: create a minimal ExtractedChunk with given text and id */
function makeChunk(id: string, text: string): ExtractedChunk {
  return {
    chunkId: id,
    hash: id,
    text,
    sourceType: "file",
    sourceId: "test-submission",
    anchor: { type: "file", page: 1, blockId: `block-${id}` },
  };
}

/** Helper: construct the service with mocked DI dependencies */
function makeService(
  promptReturnValue = JSON.stringify({ evidence: [] }),
): CriterionEvidenceRetrievalService {
  return new CriterionEvidenceRetrievalService(
    {
      processStructuredPrompt: jest
        .fn()
        .mockResolvedValue(JSON.parse(promptReturnValue)),
    } as any,
    {
      getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
    } as any,
  );
}

describe("CriterionEvidenceRetrievalService", () => {
  it("returns empty evidence when no chunks are available", async () => {
    const service = makeService();

    const criterion: RubricCriterion = {
      id: "c1",
      rubricQuestion: "Criterion",
      description: "Description",
      criteria: [{ description: "Level", points: 1 }],
      maxPoints: 1,
    };

    const index = new ChunkIndex([]);

    const response = await service.retrieveEvidence(
      {
        criterion,
        question: "Question",
        chunks: [],
        assignmentId: 1,
      },
      index,
    );

    expect(response.evidence).toHaveLength(0);
    expect(response.strategyUsed).toBe("search");
  });

  /**
   * Spreadsheet data (pure numeric / short cell values) has zero lexical
   * overlap with abstract rubric language, so computeRelevanceScore returns 0
   * for all candidates and the >= 0.15 filter strips reranked to length 0.
   * The full corpus must still be surfaced as *candidates* to LLM validation
   * (not as final evidence) so a genuinely relevant chunk can still be found.
   */
  it("surfaces the full corpus as candidates to LLM validation when all are filtered by relevance", async () => {
    const chunks = [
      makeChunk("ch1", "100"),
      makeChunk("ch2", "200"),
      makeChunk("ch3", "ABC"),
      makeChunk("ch4", "XY"),
      makeChunk("ch5", "Q1 Sales 2024"),
    ];

    const criterion: RubricCriterion = {
      id: "empty-rows",
      rubricQuestion:
        "Has the learner removed empty rows from the spreadsheet?",
      description: "Empty rows should be deleted before submission.",
      criteria: [
        { description: "All empty rows removed", points: 2 },
        { description: "Some empty rows remain", points: 1 },
        { description: "Many empty rows remain", points: 0 },
      ],
      maxPoints: 2,
    };

    const promptProcessor = {
      processStructuredPrompt: jest.fn().mockResolvedValue({
        evidence: [{ chunkId: "ch5", relevance: "supports" }],
      }),
    };
    const service = new CriterionEvidenceRetrievalService(
      promptProcessor as any,
      {
        getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
      } as any,
    );
    const index = new ChunkIndex(chunks);

    const response = await service.retrieveEvidence(
      {
        criterion,
        question: "Grade this Excel submission",
        chunks,
        assignmentId: 42,
      },
      index,
    );

    expect(response.evidence).toEqual([
      expect.objectContaining({ chunkId: "ch5" }),
    ]);
    const promptArg = promptProcessor.processStructuredPrompt.mock.calls[0][0];
    const validationPrompt = await promptArg.format({});
    for (const chunk of chunks) {
      expect(validationPrompt).toContain(chunk.chunkId);
    }
  });

  /**
   * If none of the surfaced candidates actually address the criterion, the
   * LLM validator's "nothing relevant" verdict must be trusted as final —
   * not overridden with the raw, unvalidated candidates. Otherwise an
   * off-topic submission would always produce non-empty "evidence".
   */
  it("returns no evidence when the LLM validator finds nothing relevant", async () => {
    const chunks = [
      makeChunk("ch1", "This document is about something unrelated."),
    ];

    const criterion: RubricCriterion = {
      id: "c1",
      rubricQuestion: "Did the learner implement the required DataLoader?",
      description: "Checks for DataLoader implementation.",
      criteria: [
        { description: "Implemented", points: 5 },
        { description: "Not implemented", points: 0 },
      ],
      maxPoints: 5,
    };

    const service = makeService(JSON.stringify({ evidence: [] }));
    const index = new ChunkIndex(chunks);

    const response = await service.retrieveEvidence(
      {
        criterion,
        question: "Grade this submission",
        chunks,
        assignmentId: 1,
      },
      index,
    );

    expect(response.evidence).toHaveLength(0);
  });

  it("re-validates an empty verdict once before returning no evidence", async () => {
    const chunk = makeChunk(
      "ch1",
      "The DataLoader implementation loads the training data.",
    );
    const criterion: RubricCriterion = {
      id: "c-revalidate",
      rubricQuestion: "Was DataLoader implemented?",
      description: "Checks the DataLoader implementation.",
      criteria: [
        { description: "Implemented", points: 5 },
        { description: "Not implemented", points: 0 },
      ],
      maxPoints: 5,
    };
    const promptProcessor = {
      processStructuredPrompt: jest
        .fn()
        .mockResolvedValueOnce({ evidence: [] })
        .mockResolvedValueOnce({
          evidence: [{ chunkId: "ch1", relevance: "supports" }],
        }),
    };
    const service = new CriterionEvidenceRetrievalService(
      promptProcessor as any,
      {
        getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
      } as any,
    );

    const response = await service.retrieveEvidence(
      {
        criterion,
        question: "Grade this submission",
        chunks: [chunk],
        assignmentId: 1,
      },
      new ChunkIndex([chunk]),
    );

    expect(promptProcessor.processStructuredPrompt).toHaveBeenCalledTimes(2);
    expect(response.evidence).toEqual([
      expect.objectContaining({ chunkId: "ch1" }),
    ]);
  });

  it("falls back to scored candidates when validator output cannot be parsed", async () => {
    const chunks = [
      makeChunk("ch1", "The DataLoader implementation loads training data."),
    ];

    const criterion: RubricCriterion = {
      id: "c-parse-fail",
      rubricQuestion: "Did the learner implement the required DataLoader?",
      description: "Checks for DataLoader implementation.",
      criteria: [
        { description: "Implemented", points: 5 },
        { description: "Not implemented", points: 0 },
      ],
      maxPoints: 5,
    };

    const service = new CriterionEvidenceRetrievalService(
      {
        processStructuredPrompt: jest
          .fn()
          .mockRejectedValue(new Error("invalid structured output")),
      } as any,
      {
        getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
      } as any,
    );
    const index = new ChunkIndex(chunks);

    const response = await service.retrieveEvidence(
      {
        criterion,
        question: "Grade this submission",
        chunks,
        assignmentId: 1,
      },
      index,
    );

    expect(response.evidence).toEqual([
      expect.objectContaining({ chunkId: "ch1" }),
    ]);
  });

  /**
   * When MiniSearch itself returns 0 candidates (completely empty index or
   * query yields nothing), the fallback still surfaces candidates for LLM
   * validation, and a genuine match should come through as evidence.
   */
  it("surfaces candidates via fallback when MiniSearch returns zero candidates", async () => {
    const chunks = [makeChunk("ch1", "X")];

    const criterion: RubricCriterion = {
      id: "c-zero",
      rubricQuestion: "Did the learner complete the task?",
      description: "Completion check.",
      criteria: [
        { description: "Completed", points: 1 },
        { description: "Not completed", points: 0 },
      ],
      maxPoints: 1,
    };

    const service = makeService(
      JSON.stringify({ evidence: [{ chunkId: "ch1", relevance: "supports" }] }),
    );
    const index = new ChunkIndex(chunks);

    const response = await service.retrieveEvidence(
      {
        criterion,
        question: "Check completion",
        chunks,
        assignmentId: 1,
      },
      index,
    );

    expect(response.evidence.length).toBeGreaterThan(0);
  });

  /**
   * Pinned chunks (the whole-file block for code uploads) must always be
   * offered to the LLM validator, even when lexical search ranks other
   * chunks and drops them — the validator remains the final judge.
   */
  it("always surfaces pinned chunks as candidates to the validator", async () => {
    const criterion: RubricCriterion = {
      id: "c-style",
      rubricQuestion: "Is the program well structured overall?",
      description: "Program structure and organization.",
      criteria: [
        { description: "Well structured program", points: 2 },
        { description: "Poorly structured program", points: 0 },
      ],
      maxPoints: 2,
    };

    // Lexically strong chunks that match the criterion wording, plus a
    // pinned whole-file chunk with no lexical overlap at all.
    const chunks = [
      makeChunk("fn1", "structured program organization well structured"),
      makeChunk("fn2", "the program is well structured and organized"),
      {
        ...makeChunk("whole", "def f():\n\treturn 1"),
        metadata: { filename: "solution.py", pinned: true },
      },
    ];

    const promptProcessor = {
      processStructuredPrompt: jest.fn().mockResolvedValue({
        evidence: [{ chunkId: "whole", relevance: "supports" }],
      }),
    };
    const service = new CriterionEvidenceRetrievalService(
      promptProcessor as any,
      {
        getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
      } as any,
    );
    const index = new ChunkIndex(chunks);

    const response = await service.retrieveEvidence(
      {
        criterion,
        question: "Grade this code submission",
        chunks,
        assignmentId: 1,
      },
      index,
    );

    const promptArg = promptProcessor.processStructuredPrompt.mock.calls[0][0];
    const validationPrompt = await promptArg.format({});
    expect(validationPrompt).toContain("whole");
    expect(response.evidence).toEqual([
      expect.objectContaining({ chunkId: "whole" }),
    ]);
  });

  /**
   * Source-code chunks keep their full text as the evidence quote (a
   * 220-char fragment can't show whether a function works); prose chunks
   * keep the historical 220-char cap.
   */
  it("does not truncate evidence quotes for source-code chunks", async () => {
    const longCode = `def f():\n${"    x = 1\n".repeat(100)}`;
    const longProse = "word ".repeat(200);
    const chunks = [
      {
        ...makeChunk("code", longCode),
        metadata: { filename: "solution.py" },
      },
      makeChunk("prose", longProse),
    ];

    const criterion: RubricCriterion = {
      id: "c-quote",
      rubricQuestion: "Quote length check",
      description: "Quote length check.",
      criteria: [{ description: "Level", points: 1 }],
      maxPoints: 1,
    };

    const service = makeService(
      JSON.stringify({
        evidence: [
          { chunkId: "code", relevance: "supports" },
          { chunkId: "prose", relevance: "supports" },
        ],
      }),
    );
    const index = new ChunkIndex(chunks);

    const response = await service.retrieveEvidence(
      { criterion, question: "Grade", chunks, assignmentId: 1 },
      index,
    );

    const codeEvidence = response.evidence.find((e) => e.chunkId === "code");
    const proseEvidence = response.evidence.find((e) => e.chunkId === "prose");
    expect(codeEvidence?.quote).toBe(longCode);
    expect(proseEvidence?.quote?.length).toBe(220);
  });

  /**
   * When the LLM validator fails outright, the no-validation fallback must
   * still include pinned chunks: they are appended after the lexical top-N,
   * so a purely positional slice would drop the whole-file view exactly in
   * the degraded path where it matters most.
   */
  it("keeps the pinned chunk in fallback evidence when the validator errors and reranked is full", async () => {
    const criterion: RubricCriterion = {
      id: "c-holistic",
      rubricQuestion: "Is the program well structured overall?",
      description: "Program structure and organization.",
      criteria: [{ description: "Well structured program", points: 2 }],
      maxPoints: 2,
    };

    const strongText =
      "the program is well structured and organized with clear program structure and organization overall";
    const chunks = [
      ...Array.from({ length: 6 }, (_, index) =>
        makeChunk(`strong${index}`, strongText),
      ),
      {
        ...makeChunk("whole", "def f():\n\treturn 1"),
        metadata: { filename: "solution.py", pinned: true },
      },
    ];

    const service = new CriterionEvidenceRetrievalService(
      {
        processStructuredPrompt: jest
          .fn()
          .mockRejectedValue(new Error("validator timeout")),
      } as any,
      {
        getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
      } as any,
    );

    const response = await service.retrieveEvidence(
      { criterion, question: "Grade this code", chunks, assignmentId: 1 },
      new ChunkIndex(chunks),
    );

    expect(response.evidence.length).toBeLessThanOrEqual(6);
    expect(response.evidence.some((item) => item.chunkId === "whole")).toBe(
      true,
    );
  });

  /**
   * The validation prompt budgets full-length code excerpts (pinned first);
   * past the budget, chunks fall back to the short prose excerpt so the
   * zero-relevance fallback cannot render ~100KB prompts.
   */
  it("bounds the validation prompt via the code render budget, pinned chunk first", async () => {
    const pinnedText = `PINNED_HEAD ${"p".repeat(11_900)} PINNED_TAIL`;
    const segmentText = `SEGMENT_BODY ${"s".repeat(5900)}`;
    const chunks = [
      ...Array.from({ length: 10 }, (_, index) => ({
        ...makeChunk(`seg${index}`, segmentText),
        metadata: { filename: "solution.py" },
      })),
      {
        ...makeChunk("whole", pinnedText),
        metadata: { filename: "solution.py", pinned: true },
      },
    ];

    let validationPrompt = "";
    const service = new CriterionEvidenceRetrievalService(
      {
        processStructuredPrompt: jest
          .fn()
          .mockImplementation(async (prompt: any) => {
            validationPrompt = await prompt.format({});
            return { evidence: [{ chunkId: "whole", relevance: "supports" }] };
          }),
      } as any,
      {
        getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
      } as any,
    );

    const criterion: RubricCriterion = {
      id: "c-budget",
      rubricQuestion: "Budget check",
      description: "Budget check.",
      criteria: [{ description: "Level", points: 1 }],
      maxPoints: 1,
    };

    await service.retrieveEvidence(
      { criterion, question: "Grade", chunks, assignmentId: 1 },
      new ChunkIndex(chunks),
    );

    // Pinned chunk rendered in full despite being listed after the segments.
    expect(validationPrompt).toContain("PINNED_TAIL");
    // All chunks are still listed as candidates...
    for (let index = 0; index < 10; index += 1) {
      expect(validationPrompt).toContain(`seg${index}`);
    }
    // ...but total rendered size stays near the budget instead of ~72KB.
    expect(validationPrompt.length).toBeLessThan(40_000);
  });

  it("does not truncate evidence quotes for notebook chunks", async () => {
    const cellText = `=== CELL 2 [CODE] [1] ===\n${"x = 1\n".repeat(400)}`;
    const chunks = [
      {
        ...makeChunk("cell", cellText),
        metadata: { filename: "analysis.ipynb" },
      },
      makeChunk("prose", "word ".repeat(200)),
    ];

    const criterion: RubricCriterion = {
      id: "c-nb-quote",
      rubricQuestion: "Notebook quote length check",
      description: "Notebook quote length check.",
      criteria: [{ description: "Level", points: 1 }],
      maxPoints: 1,
    };

    const service = makeService(
      JSON.stringify({
        evidence: [
          { chunkId: "cell", relevance: "supports" },
          { chunkId: "prose", relevance: "supports" },
        ],
      }),
    );

    const response = await service.retrieveEvidence(
      { criterion, question: "Grade", chunks, assignmentId: 1 },
      new ChunkIndex(chunks),
    );

    const cellEvidence = response.evidence.find((e) => e.chunkId === "cell");
    const proseEvidence = response.evidence.find((e) => e.chunkId === "prose");
    expect(cellEvidence?.quote).toBe(cellText);
    expect(proseEvidence?.quote?.length).toBe(220);
  });

  /**
   * The validator prompt is designed to pick the best six chunks FROM a wider
   * candidate pool ("Keep only the most relevant 6 chunks. Where more than
   * six qualify..."). Slicing the pool to six before the validator ever sees
   * it silently delegates the final relevance judgement to lexical scoring —
   * which ranks rubric-parroting template text above the learner's actual
   * code (observed in production as "submission shows only the solution
   * template" false zeros on notebook uploads). The full reranked pool must
   * reach the validator; only the validator's verdict is capped at six.
   */
  it("surfaces the full reranked candidate pool to the validator, not only the lexical top six", async () => {
    const core = "notebook python code bar chart";
    const chunks = Array.from({ length: 9 }, (_, i) =>
      makeChunk(
        `ch${i + 1}`,
        `${core} variant-${i + 1} ${"filler ".repeat(i * 3)}`,
      ),
    );

    const criterion: RubricCriterion = {
      id: "bar-chart",
      rubricQuestion:
        "Does the notebook include Python code to create a bar chart?",
      description: "The notebook must include Python code for a bar chart.",
      criteria: [
        { description: "Correct bar chart code", points: 2 },
        { description: "Partial bar chart code", points: 1 },
        { description: "No bar chart code", points: 0 },
      ],
      maxPoints: 2,
    };

    const promptProcessor = {
      processStructuredPrompt: jest.fn().mockResolvedValue({
        evidence: [{ chunkId: "ch9", relevance: "supports" }],
      }),
    };
    const service = new CriterionEvidenceRetrievalService(
      promptProcessor as any,
      {
        getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
      } as any,
    );
    const index = new ChunkIndex(chunks);

    const response = await service.retrieveEvidence(
      {
        criterion,
        question: "Grade this notebook submission",
        chunks,
        assignmentId: 7,
      },
      index,
    );

    const promptArg = promptProcessor.processStructuredPrompt.mock.calls[0][0];
    const validationPrompt = await promptArg.format({});
    for (const chunk of chunks) {
      expect(validationPrompt).toContain(chunk.chunkId);
    }
    expect(response.evidence).toEqual([
      expect.objectContaining({ chunkId: "ch9" }),
    ]);
  });

  /**
   * Merged prose sections (a page/slide of a document) carry their full text
   * as the evidence quote — re-truncating them to the 220-char prose cap
   * would undo the merge and hand the grader a fragment again.
   */
  it("does not truncate evidence quotes for prose section chunks", async () => {
    const sectionText = `Stakeholder Analysis and Engagement Plan\n${"detail line about roles and influence levels\n".repeat(20)}`;
    const chunks = [
      {
        ...makeChunk("sec", sectionText),
        metadata: { filename: "report.pdf", section: true },
      },
      makeChunk("prose", "word ".repeat(200)),
    ];

    const criterion: RubricCriterion = {
      id: "c-section-quote",
      rubricQuestion: "Section quote length check",
      description: "Section quote length check.",
      criteria: [{ description: "Level", points: 1 }],
      maxPoints: 1,
    };

    const service = makeService(
      JSON.stringify({
        evidence: [
          { chunkId: "sec", relevance: "supports" },
          { chunkId: "prose", relevance: "supports" },
        ],
      }),
    );

    const response = await service.retrieveEvidence(
      { criterion, question: "Grade", chunks, assignmentId: 1 },
      new ChunkIndex(chunks),
    );

    const sectionEvidence = response.evidence.find((e) => e.chunkId === "sec");
    const proseEvidence = response.evidence.find((e) => e.chunkId === "prose");
    expect(sectionEvidence?.quote).toBe(sectionText);
    expect(proseEvidence?.quote?.length).toBe(220);
  });

  /**
   * When fewer candidates pass the lexical relevance threshold than the
   * evidence cap, the thin pool signals a weak relevance signal (verbose
   * criteria dilute token overlap), not a thin submission. Collapsing the
   * pool to the one surviving chunk made the validator judge a criterion on
   * a bare heading (observed in production as "slide contains only a
   * heading" zeros on document uploads). The full ranked candidate pool must
   * reach the validator instead.
   */
  it("surfaces the full candidate pool to the validator when few chunks pass the relevance threshold", async () => {
    const criterion: RubricCriterion = {
      id: "c-thin-pool",
      rubricQuestion:
        "Did the learner complete the stakeholder analysis and engagement plan slide, naming stakeholders with their influence, interest, and communication approach?",
      description:
        "The slide must identify stakeholders and describe influence, interest, and the planned engagement approach for each.",
      criteria: [
        { description: "Complete stakeholder analysis", points: 4 },
        { description: "No stakeholder analysis", points: 0 },
      ],
      maxPoints: 4,
    };

    // The heading parrots the criterion wording (high overlap, passes the
    // threshold); the body chunks share only one token ("stakeholder") so
    // they are searchable but fall below the relevance threshold.
    const chunks = [
      makeChunk(
        "heading",
        "Stakeholder analysis and engagement plan slide: stakeholders, influence, interest, communication approach",
      ),
      makeChunk(
        "body1",
        "stakeholder Hospital Director requires weekly briefings and holds final budget sign-off",
      ),
      makeChunk(
        "body2",
        "stakeholder Nursing Lead prefers daily stand-ups and owns triage workflow changes",
      ),
    ];

    const promptProcessor = {
      processStructuredPrompt: jest.fn().mockResolvedValue({
        evidence: [
          { chunkId: "heading", relevance: "partial" },
          { chunkId: "body1", relevance: "supports" },
          { chunkId: "body2", relevance: "supports" },
        ],
      }),
    };
    const service = new CriterionEvidenceRetrievalService(
      promptProcessor as any,
      {
        getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
      } as any,
    );

    const response = await service.retrieveEvidence(
      {
        criterion,
        question: "Grade this presentation",
        chunks,
        assignmentId: 1,
      },
      new ChunkIndex(chunks),
    );

    const promptArg = promptProcessor.processStructuredPrompt.mock.calls[0][0];
    const validationPrompt = await promptArg.format({});
    for (const chunk of chunks) {
      expect(validationPrompt).toContain(chunk.chunkId);
    }
    expect(response.evidence.some((item) => item.chunkId === "body1")).toBe(
      true,
    );
  });
});
