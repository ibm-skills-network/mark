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
});
