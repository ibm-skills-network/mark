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
      processPromptForFeature: jest.fn().mockResolvedValue(
        JSON.stringify({
          evidence: [{ chunkId: "ch5", relevance: "supports" }],
        }),
      ),
    };
    const service = new CriterionEvidenceRetrievalService(
      promptProcessor as any,
      {
        getModelForValidationTask: jest.fn().mockResolvedValue("test-model"),
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
    const promptArg = promptProcessor.processPromptForFeature.mock.calls[0][0];
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

    const service = makeService("not valid json");
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

  describe("validation outcomes", () => {
    const criterion: RubricCriterion = {
      id: "c-validate",
      rubricQuestion: "Does the submission explain database normalization?",
      description: "Normalization explanation check.",
      criteria: [
        { description: "Explained", points: 2 },
        { description: "Not explained", points: 0 },
      ],
      maxPoints: 2,
    };

    async function run(promptReturnValue: string) {
      const chunks = [
        makeChunk("ch1", "Normalization reduces database redundancy."),
        makeChunk("ch2", "Some unrelated learner text about databases."),
      ];
      const service = makeService(promptReturnValue);
      const index = new ChunkIndex(chunks);
      return service.retrieveEvidence(
        {
          criterion,
          question: "Explain normalization",
          chunks,
          assignmentId: 1,
        },
        index,
      );
    }

    it("marks supported evidence as validated", async () => {
      const response = await run(
        JSON.stringify({
          evidence: [{ chunkId: "ch1", relevance: "supports" }],
        }),
      );
      expect(response.validationOutcome).toBe("validated");
      expect(response.evidence).toHaveLength(1);
      expect(response.evidence[0].chunkId).toBe("ch1");
    });

    it("respects an explicit irrelevant rejection and does not fall back", async () => {
      const response = await run(
        JSON.stringify({
          evidence: [
            { chunkId: "ch1", relevance: "irrelevant" },
            { chunkId: "ch2", relevance: "irrelevant" },
          ],
        }),
      );
      expect(response.validationOutcome).toBe("rejected");
      expect(response.evidence).toHaveLength(0);
    });

    it("respects an explicit boilerplate_only rejection and does not fall back", async () => {
      const response = await run(
        JSON.stringify({
          evidence: [{ chunkId: "ch1", relevance: "boilerplate_only" }],
        }),
      );
      expect(response.validationOutcome).toBe("rejected");
      expect(response.evidence).toHaveLength(0);
    });

    it("respects an explicit restatement_only rejection and does not fall back", async () => {
      const response = await run(
        JSON.stringify({
          evidence: [{ chunkId: "ch1", relevance: "restatement_only" }],
        }),
      );
      expect(response.validationOutcome).toBe("rejected");
      expect(response.evidence).toHaveLength(0);
    });

    it("falls back to keyword evidence on validation parse failure", async () => {
      const response = await run("this is not parseable JSON at all");
      expect(response.validationOutcome).toBe("technical_failure");
      expect(response.evidence.length).toBeGreaterThan(0);
    });

    it("treats empty validation output as validated and allows keyword fallback", async () => {
      const response = await run(JSON.stringify({ evidence: [] }));
      expect(response.validationOutcome).toBe("validated");
      expect(response.evidence.length).toBeGreaterThan(0);
    });

    it("keeps contradiction evidence visible but flagged", async () => {
      const response = await run(
        JSON.stringify({
          evidence: [{ chunkId: "ch1", relevance: "contradicts" }],
        }),
      );
      expect(response.validationOutcome).toBe("validated");
      expect(response.evidence).toHaveLength(1);
      expect(response.evidence[0].contradiction).toBe(true);
    });
  });
});
