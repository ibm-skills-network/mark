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
});
