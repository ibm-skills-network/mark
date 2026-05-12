import { PromptTemplate } from "@langchain/core/prompts";
import { QuestionType } from "@prisma/client";
import { IPromptProcessor } from "src/api/llm/core/interfaces/prompt-processor.interface";
import { IQuestionValidatorService } from "../interfaces/question-validator.interface";
import {
  AssignmentTypeEnum,
  DifficultyLevel,
  MCSubtype,
  QuestionGenerationService,
} from "./question-generation.service";

describe("QuestionGenerationService", () => {
  let service: QuestionGenerationService;
  let promptProcessor: jest.Mocked<IPromptProcessor>;
  let validatorService: jest.Mocked<IQuestionValidatorService>;

  const logger = {
    child: jest.fn().mockReturnThis(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Builds a generation-phase JSON payload containing `n` distinct single-
   * correct questions. Each question has a unique stem so semantic-duplicate
   * filters don't collapse them.
   */
  const buildGenerationResponse = (
    n: number,
    stemPrefix = "Which practice keeps code reviews focused",
  ): string =>
    JSON.stringify({
      questions: Array.from({ length: n }, (_, index) => ({
        question: `${stemPrefix} ${index}?`,
        type: QuestionType.SINGLE_CORRECT,
        totalPoints: 1,
        difficultyLevel: DifficultyLevel.MEDIUM,
        choices: [
          {
            id: 1,
            choice: `Correct answer ${index}`,
            isCorrect: true,
            points: 1,
            feedback: "Correct.",
          },
          {
            id: 2,
            choice: `Wrong answer A ${index}`,
            isCorrect: false,
            points: 0,
            feedback: "Incorrect.",
          },
          {
            id: 3,
            choice: `Wrong answer B ${index}`,
            isCorrect: false,
            points: 0,
            feedback: "Incorrect.",
          },
          {
            id: 4,
            choice: `Wrong answer C ${index}`,
            isCorrect: false,
            points: 0,
            feedback: "Incorrect.",
          },
        ],
        scoring: null,
      })),
    });

  const multipleChoiceResponse = JSON.stringify({
    questions: [
      {
        question: "Which practice keeps code reviews focused?",
        type: QuestionType.SINGLE_CORRECT,
        totalPoints: 1,
        difficultyLevel: DifficultyLevel.MEDIUM,
        choices: [
          {
            id: 1,
            choice: "Small, scoped pull requests",
            isCorrect: true,
            points: 1,
            feedback:
              "Correct. Smaller pull requests are easier to review well.",
          },
          {
            id: 2,
            choice: "Bundling unrelated refactors together",
            isCorrect: false,
            points: 0,
            feedback: "Incorrect. Mixing unrelated work makes review harder.",
          },
          {
            id: 3,
            choice: "Skipping tests until after approval",
            isCorrect: false,
            points: 0,
            feedback:
              "Incorrect. Tests should already support the proposed change.",
          },
          {
            id: 4,
            choice: "Reviewing only after deployment",
            isCorrect: false,
            points: 0,
            feedback:
              "Incorrect. Review should happen before merge or deployment.",
          },
        ],
        scoring: null,
      },
    ],
  });

  const reviewResponse = JSON.stringify([
    {
      question: "Which practice keeps code reviews focused?",
      type: MCSubtype.SHORT,
      page: 0,
    },
  ]);

  beforeEach(() => {
    promptProcessor = {
      processPromptForFeature: jest.fn(),
      processPrompt: jest.fn(),
      processPromptWithImage: jest.fn(),
    };

    validatorService = {
      validateQuestions: jest.fn().mockResolvedValue({
        isValid: true,
        hasImprovements: false,
        issues: {},
        improvements: {},
      }),
    };

    service = new QuestionGenerationService(
      promptProcessor,
      validatorService,
      logger as any,
    );
  });

  it("keeps the standard multiple-choice prompt path when no subtype counts are provided", async () => {
    promptProcessor.processPromptForFeature.mockResolvedValue(
      multipleChoiceResponse,
    );

    const reviewSpy = jest.spyOn(service as any, "reviewSubtypeQuestions");

    await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 1,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
      },
      "Code review content",
    );

    const generationPrompt = promptProcessor.processPromptForFeature.mock
      .calls[0][0] as PromptTemplate;
    const formattedPrompt = await generationPrompt.format({});

    expect(formattedPrompt).toContain(
      "Generate 1 MULTIPLE_CHOICE (SINGLE_CORRECT) questions:",
    );
    expect(formattedPrompt).not.toContain("SHORT QUESTION RULES");
    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it("accepts maxWords:0 and maxCharacters:0 from the model and substitutes defaults", async () => {
    // The model frequently emits 0 for maxWords/maxCharacters on non-TEXT questions
    // instead of omitting the fields. Schema must accept these without failing
    // generation; downstream mapping should then substitute the difficulty default.
    const responseWithZeroLimits = JSON.stringify({
      questions: [
        {
          question: "Which practice keeps code reviews focused?",
          type: QuestionType.SINGLE_CORRECT,
          totalPoints: 1,
          difficultyLevel: DifficultyLevel.MEDIUM,
          maxWords: 0,
          maxCharacters: 0,
          choices: [
            {
              id: 1,
              choice: "Small, scoped pull requests",
              isCorrect: true,
              points: 1,
              feedback: "Correct.",
            },
            {
              id: 2,
              choice: "Bundling unrelated refactors together",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect.",
            },
            {
              id: 3,
              choice: "Skipping tests until after approval",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect.",
            },
            {
              id: 4,
              choice: "Reviewing only after deployment",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect.",
            },
          ],
          scoring: null,
        },
      ],
    });

    promptProcessor.processPromptForFeature.mockResolvedValue(
      responseWithZeroLimits,
    );

    const result = await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 1,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
      },
      "Code review content",
    );

    expect(promptProcessor.processPromptForFeature).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining("Batch generation error"),
    );
    expect(result).toHaveLength(1);
    // SINGLE_CORRECT has no word/char limit. The model's 0 must not survive into
    // the mapped question — downstream code at the call site uses truthiness, so
    // 0 collapses to the type-default (undefined for non-TEXT).
    expect(result[0].maxWords).not.toBe(0);
    expect(result[0].maxCharacters).not.toBe(0);
  });

  it("uses the subtype-specific prompt and review path when multiple-choice subtype counts are requested", async () => {
    promptProcessor.processPromptForFeature
      .mockResolvedValueOnce(multipleChoiceResponse)
      .mockResolvedValueOnce(reviewResponse);

    const subtypeInstructionSpy = jest.spyOn(
      service as any,
      "getMCSubtypeInstructions",
    );
    const reviewSpy = jest.spyOn(service as any, "reviewSubtypeQuestions");
    const finalizeSpy = jest.spyOn(service as any, "finalizeSubtypeQuestions");

    const result = await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 1,
          quantitative: 0,
          long: 0,
          scenario: 0,
        },
      },
      "Code review content",
    );

    const generationPrompt = promptProcessor.processPromptForFeature.mock
      .calls[0][0] as PromptTemplate;
    const formattedPrompt = await generationPrompt.format({});

    expect(formattedPrompt).toContain("SHORT QUESTION RULES:");
    expect(formattedPrompt).toContain(
      "Generate 1 MULTIPLE_CHOICE (SINGLE_CORRECT) SHORT-subtype questions.",
    );
    expect(subtypeInstructionSpy).toHaveBeenCalledWith(1, MCSubtype.SHORT);
    expect(reviewSpy).toHaveBeenCalled();
    expect(finalizeSpy).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: QuestionType.SINGLE_CORRECT,
      mcSubtype: MCSubtype.SHORT,
    });
    expect(result[0].choices).toHaveLength(4);
  });

  // ────────────────────────────────────────────────────────────────────────
  // New coverage: review edge cases and parallel shortfall
  // ────────────────────────────────────────────────────────────────────────

  it("falls through to shortfall generation when review returns an empty array", async () => {
    // 1: generation returns 1 short question
    // 2: review returns [] (drops the single question)
    // 3: finalize shortfall batch generates a replacement short question
    // 4: re-review of the shortfall-generated question
    promptProcessor.processPromptForFeature
      .mockResolvedValueOnce(buildGenerationResponse(1))
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce(buildGenerationResponse(1, "Shortfall stem"))
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            question: "Shortfall stem 0?",
            type: MCSubtype.SHORT,
            page: 0,
          },
        ]),
      );

    const reviewSpy = jest.spyOn(service as any, "reviewSubtypeQuestions");
    const finalizeSpy = jest.spyOn(service as any, "finalizeSubtypeQuestions");

    const result = await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 1,
          quantitative: 0,
          long: 0,
          scenario: 0,
        },
      },
      "Code review content",
    );

    expect(reviewSpy).toHaveBeenCalled();
    expect(finalizeSpy).toHaveBeenCalled();
    // At least 3 calls: initial gen, initial review, shortfall gen.
    // The re-review of shortfall brings it to 4. Assert >=3 to be resilient
    // to the re-review being optional for a single-question path.
    expect(
      promptProcessor.processPromptForFeature.mock.calls.length,
    ).toBeGreaterThanOrEqual(3);
    expect(result).toHaveLength(1);
    expect(result[0].mcSubtype).toBe(MCSubtype.SHORT);
  });

  it("preserves both items via positional fallback when review returns out-of-range pages", async () => {
    promptProcessor.processPromptForFeature
      .mockResolvedValueOnce(buildGenerationResponse(2))
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            question: "Which practice keeps code reviews focused 0?",
            type: MCSubtype.SHORT,
            page: 99, // out of range
          },
          {
            question: "Which practice keeps code reviews focused 1?",
            type: MCSubtype.SHORT,
            page: -1, // out of range
          },
        ]),
      );

    logger.warn.mockClear();

    const result = await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 2,
          quantitative: 0,
          long: 0,
          scenario: 0,
        },
      },
      "Code review content",
    );

    // No shortfall should have been needed — only 2 prompt calls total
    expect(promptProcessor.processPromptForFeature).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    for (const q of result) {
      expect(q.mcSubtype).toBe(MCSubtype.SHORT);
    }

    // No "dropped N of M" warning — items should have been reconciled positionally
    const droppedWarnings = logger.warn.mock.calls.filter(
      ([message]: [string]) =>
        typeof message === "string" && message.includes("Review dropped"),
    );
    expect(droppedWarnings).toHaveLength(0);
  });

  it("keeps 3 questions when review returns duplicate page numbers via positional fallback", async () => {
    promptProcessor.processPromptForFeature
      .mockResolvedValueOnce(buildGenerationResponse(3))
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            question: "Which practice keeps code reviews focused 0?",
            type: MCSubtype.SHORT,
            page: 0, // claims position 0 via page
          },
          {
            question: "Which practice keeps code reviews focused 1?",
            type: MCSubtype.SHORT,
            page: 0, // duplicate — must fall back to positional (1)
          },
          {
            question: "Which practice keeps code reviews focused 2?",
            type: MCSubtype.SHORT,
            page: 0, // duplicate — must fall back to positional (2)
          },
        ]),
      );

    const result = await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 3,
          quantitative: 0,
          long: 0,
          scenario: 0,
        },
      },
      "Code review content",
    );

    // Only generation + review — no shortfall needed
    expect(promptProcessor.processPromptForFeature).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(3);
    for (const q of result) {
      expect(q.mcSubtype).toBe(MCSubtype.SHORT);
    }
  });

  it("accepts a mixed-case subtype value via case-insensitive isMCSubtype", async () => {
    promptProcessor.processPromptForFeature
      .mockResolvedValueOnce(buildGenerationResponse(1))
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            question: "Which practice keeps code reviews focused 0?",
            type: "SHORT", // uppercase — must be accepted and normalised
            page: 0,
          },
        ]),
      );

    const result = await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 1,
          quantitative: 0,
          long: 0,
          scenario: 0,
        },
      },
      "Code review content",
    );

    // Generation + review only — stem and subtype both unchanged after
    // normalisation, so no choice regeneration should fire.
    expect(promptProcessor.processPromptForFeature).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].mcSubtype).toBe(MCSubtype.SHORT);
  });

  it("does not break the review prompt when content contains curly braces", async () => {
    promptProcessor.processPromptForFeature
      .mockResolvedValueOnce(buildGenerationResponse(1))
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            question: "Which practice keeps code reviews focused 0?",
            type: MCSubtype.SHORT,
            page: 0,
          },
        ]),
      );

    const result = await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 1,
          quantitative: 0,
          long: 0,
          scenario: 0,
        },
      },
      "Use the {placeholder} to {config}",
    );

    expect(result).toHaveLength(1);

    // The second call to processPromptForFeature is the review prompt.
    // Formatting it must not throw — if braces weren't escaped, LangChain
    // would try to resolve `{placeholder}` / `{config}` as template inputs.
    const reviewPrompt = promptProcessor.processPromptForFeature.mock
      .calls[1][0] as PromptTemplate;
    const formatted = await reviewPrompt.format({});
    expect(formatted).toContain("{placeholder}");
    expect(formatted).toContain("{config}");
  });

  it("truncates review-prompt content that exceeds the 8000-char limit", async () => {
    const hugeContent = "A".repeat(10_000);

    promptProcessor.processPromptForFeature
      .mockResolvedValueOnce(buildGenerationResponse(1))
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            question: "Which practice keeps code reviews focused 0?",
            type: MCSubtype.SHORT,
            page: 0,
          },
        ]),
      );

    await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 1,
          quantitative: 0,
          long: 0,
          scenario: 0,
        },
      },
      hugeContent,
    );

    const reviewPrompt = promptProcessor.processPromptForFeature.mock
      .calls[1][0] as PromptTemplate;
    const formatted = await reviewPrompt.format({});

    // The embedded content should include the truncation marker.
    expect(formatted).toContain("[content truncated for review]");

    // Extract the CONTENT:...QUESTIONS TO REVIEW: section and assert the
    // character run of 'A' characters is ≤ 8000 (+ marker slack).
    const contentMatch = formatted.match(/CONTENT:\n([\s\S]*?)\n\n/);
    expect(contentMatch).not.toBeNull();
    const embeddedContent = contentMatch![1];
    // The truncation suffix adds ~40 chars; the limit is 8000.
    expect(embeddedContent.length).toBeLessThanOrEqual(8100);
  });

  it("initiates all 4 subtype shortfall batches in parallel when the pool is empty", async () => {
    // Generation for each of 4 subtypes returns 0 questions (empty), forcing
    // all 4 subtypes into shortfall. Each shortfall batch is mocked to wait
    // on a shared barrier until all 4 have been initiated.
    const emptyGenerationResponse = JSON.stringify({ questions: [] });

    // The review is only called once the generation phase finishes; with 0
    // subtype questions after generation, reviewSubtypeQuestions is called
    // but returns immediately (no subtype questions to review).
    // Then finalizeSubtypeQuestions runs 4 shortfall batches in parallel.

    let shortfallInitiated = 0;
    const resolvers: Array<() => void> = [];
    const TOTAL_SHORTFALL_BATCHES = 4;

    const makeShortfallMock = (subtypeLabel: string) => () =>
      new Promise<string>((resolve) => {
        shortfallInitiated += 1;
        const release = () =>
          resolve(buildGenerationResponse(1, `Shortfall stem ${subtypeLabel}`));
        if (shortfallInitiated >= TOTAL_SHORTFALL_BATCHES) {
          // All 4 are in flight — drain the queue including this one.
          for (const r of resolvers) r();
          resolvers.length = 0;
          release();
        } else {
          resolvers.push(release);
        }
      });

    // Subtype order in the review input preserves bySubtype map insertion
    // order: SHORT, QUANTITATIVE, LONG, SCENARIO. The re-review input will
    // be the 4 shortfall questions in that order.
    const reReviewResponse = JSON.stringify([
      {
        question: "Shortfall stem short 0?",
        type: MCSubtype.SHORT,
        page: 0,
      },
      {
        question: "Shortfall stem quantitative 0?",
        type: MCSubtype.QUANTITATIVE,
        page: 1,
      },
      {
        question: "Shortfall stem long 0?",
        type: MCSubtype.LONG,
        page: 2,
      },
      {
        question: "Shortfall stem scenario 0?",
        type: MCSubtype.SCENARIO,
        page: 3,
      },
    ]);

    // Per-subtype shortfall stems, keyed by call index so the re-review JSON
    // matches the questions produced.
    const shortfallLabelByCall: Record<number, string> = {
      5: "short",
      6: "quantitative",
      7: "long",
      8: "scenario",
    };

    promptProcessor.processPromptForFeature.mockImplementation(
      (() => {
        let call = 0;
        return () => {
          call += 1;
          // Calls 1..4: initial generation batches (one per subtype).
          // With 4 subtypes, BATCH_CONCURRENCY=2 → batches are awaited in
          // groups of 2 but that does not affect correctness here.
          if (call <= 4) {
            return Promise.resolve(emptyGenerationResponse);
          }
          // Calls 5..8: the 4 parallel shortfall batches. Use the barrier.
          if (call <= 8) {
            const label = shortfallLabelByCall[call];
            return makeShortfallMock(label)();
          }
          // Call 9: re-review of shortfall questions.
          return Promise.resolve(reReviewResponse);
        };
      })(),
    );

    const result = await service.generateAssignmentQuestions(
      1,
      AssignmentTypeEnum.QUIZ,
      {
        multipleChoice: 0,
        multipleSelect: 0,
        textResponse: 0,
        trueFalse: 0,
        url: 0,
        upload: 0,
        linkFile: 0,
        multipleChoiceSubtypes: {
          short: 1,
          quantitative: 1,
          long: 1,
          scenario: 1,
        },
      },
      "Code review content",
    );

    // All 4 shortfall batches must have been initiated before any resolved
    // — the barrier would deadlock otherwise and this test would time out.
    expect(shortfallInitiated).toBe(TOTAL_SHORTFALL_BATCHES);

    // 4 initial gen + 4 shortfall gen = 8 minimum; re-review adds 1 more.
    expect(
      promptProcessor.processPromptForFeature.mock.calls.length,
    ).toBeGreaterThanOrEqual(8);

    // Final result must cover all 4 subtypes.
    const subtypes = new Set(result.map((q) => q.mcSubtype));
    expect(subtypes.size).toBe(4);
    expect(subtypes).toContain(MCSubtype.SHORT);
    expect(subtypes).toContain(MCSubtype.QUANTITATIVE);
    expect(subtypes).toContain(MCSubtype.LONG);
    expect(subtypes).toContain(MCSubtype.SCENARIO);
  });
});
