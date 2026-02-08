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
  promptReturnValue = "not valid json",
): CriterionEvidenceRetrievalService {
  return new CriterionEvidenceRetrievalService(
    {
      processPromptForFeature: jest.fn().mockResolvedValue(promptReturnValue),
    } as any,
    {
      getModelForValidationTask: jest.fn().mockResolvedValue("test-model"),
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
   * REGRESSION: Spreadsheet data (pure numeric / short cell values) has zero
   * lexical overlap with abstract rubric language.  MiniSearch fuzzy+prefix
   * matching may return candidates, but computeRelevanceScore returns 0 for
   * all of them, and the >= 0.15 filter strips the reranked array to length 0.
   *
   * Before the fix the fallback only checked `candidates.length === 0`.
   * The correct check is `reranked.length === 0` (after the filter).
   * This test verifies evidence is surfaced unconditionally in that case.
   */
  it("surfaces chunks when MiniSearch returns candidates but all are filtered by relevance", async () => {
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

    const service = makeService();
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

    expect(response.evidence.length).toBe(5);
    expect(response.criterionId).toBe("empty-rows");
  });

  /**
   * When MiniSearch itself returns 0 candidates (completely empty index or
   * query yields nothing), the same fallback path should fire.
   */
  it("surfaces chunks via fallback when MiniSearch returns zero candidates", async () => {
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

    const service = makeService();
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
