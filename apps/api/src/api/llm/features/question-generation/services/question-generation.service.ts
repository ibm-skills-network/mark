/* eslint-disable unicorn/no-null */
import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType, QuestionType, ResponseType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { IPromptProcessor } from "src/api/llm/core/interfaces/prompt-processor.interface";
import { Logger } from "winston";
import { z } from "zod";
import { EnhancedQuestionsToGenerate } from "../../../../assignment/dto/post.assignment.request.dto";
import {
  Choice,
  ScoringDto,
  VariantDto,
} from "../../../../assignment/dto/update.questions.request.dto";
import { PROMPT_PROCESSOR, VALIDATOR_SERVICE } from "../../../llm.constants";
import { IQuestionGenerationService } from "../interfaces/question-generation.interface";
import { IQuestionValidatorService } from "../interfaces/question-validator.interface";

export enum AssignmentTypeEnum {
  QUIZ,
  ASSIGNMENT,
  PROJECT,
  MIDTERM,
  FINAL,
  EXAM,
  TEST,
  LAB,
  HOMEWORK,
  PRACTICE,
  ASSESSMENT,
  SURVEY,
  EVALUATION,
  REVIEW,
  REFLECTION,
}

export enum DifficultyLevel {
  BASIC = "BASIC",
  EASY = "EASY",
  MEDIUM = "MEDIUM",
  CHALLENGING = "CHALLENGING",
  ADVANCED = "ADVANCED",
}

interface IGeneratedQuestion {
  id?: number;
  question: string;
  totalPoints: number;
  type: QuestionType;
  responseType?: ResponseType;
  scoring: ScoringDto;
  choices?: Choice[];
  maxWords?: number;
  maxCharacters?: number;
  randomizedChoices?: boolean;
  variants?: VariantDto[];
  videoPresentationConfig?: VideoPresentationConfig;
  liveRecordingConfig?: LiveRecordingConfig;
  difficultyLevel?: DifficultyLevel;
  assignmentId?: number;
}

interface VideoPresentationConfig {
  evaluateSlidesQuality: boolean;
  evaluateTimeManagement: boolean;
  targetTime: number;
}

interface LiveRecordingConfig {
  evaluateBodyLanguage: boolean;
  realTimeAiCoach: boolean;
  evaluateTimeManagement: boolean;
  targetTime: number;
}

type QuestionGenerationResult = {
  success: boolean;
  questions: IGeneratedQuestion[];
  errors?: string[];
};

type CountsByType = Record<QuestionType, number>;

interface BatchGenerationParameters {
  assignmentId: number;
  types: QuestionType[];
  counts: number[];
  difficultyLevel: DifficultyLevel;
  content?: string;
  learningObjectives?: string;
}

@Injectable()
export class QuestionGenerationService implements IQuestionGenerationService {
  private readonly logger: Logger;
  private readonly MAX_GENERATION_RETRIES = 3;
  private readonly BATCH_SIZE = 5;
  private readonly BATCH_CONCURRENCY = 2;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(VALIDATOR_SERVICE)
    private readonly validatorService: IQuestionValidatorService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: QuestionGenerationService.name,
    });
  }

  async generateAssignmentQuestions(
    assignmentId: number,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: EnhancedQuestionsToGenerate,
    content?: string,
    learningObjectives?: string,
  ): Promise<IGeneratedQuestion[]> {
    if (!content && !learningObjectives) {
      throw new HttpException(
        "Provide either content, learning objectives, or both",
        HttpStatus.BAD_REQUEST,
      );
    }

    const difficultyLevel = this.mapAssignmentTypeToDifficulty(assignmentType);
    const questionCounts = this.getQuestionCountsByType(questionsToGenerate);

    // Fast path: if no questions requested, return empty array
    if (Object.values(questionCounts).every((count) => count === 0)) {
      return [];
    }

    // Create batches for concurrent generation
    const batches = this.createQuestionBatches(questionCounts);
    const allQuestions: IGeneratedQuestion[] = [];
    const batchPromises: Promise<QuestionGenerationResult>[] = [];

    // Generate questions in parallel batches
    for (const batch of batches) {
      const batchPromise = this.generateQuestionBatch({
        assignmentId: assignmentId,
        types: batch.types,
        counts: batch.counts,
        difficultyLevel,
        content,
        learningObjectives,
      });
      batchPromises.push(batchPromise);

      // Process in groups to control concurrency
      if (batchPromises.length >= this.BATCH_CONCURRENCY) {
        const results = await Promise.all(batchPromises);
        for (const result of results) {
          allQuestions.push(...result.questions);
        }
        batchPromises.length = 0;
      }
    }

    // Process any remaining batches
    if (batchPromises.length > 0) {
      const results = await Promise.all(batchPromises);
      for (const result of results) {
        allQuestions.push(...result.questions);
      }
    }

    // Final validation and ensure all required questions are included
    return this.finalizeQuestionSet(
      allQuestions,
      questionCounts,
      assignmentId,
      difficultyLevel,
      content,
      learningObjectives,
    );
  }

  private getQuestionCountsByType(
    questionsToGenerate: EnhancedQuestionsToGenerate,
  ): CountsByType {
    return {
      [QuestionType.SINGLE_CORRECT]: questionsToGenerate.multipleChoice || 0,
      [QuestionType.MULTIPLE_CORRECT]: questionsToGenerate.multipleSelect || 0,
      [QuestionType.TEXT]: questionsToGenerate.textResponse || 0,
      [QuestionType.TRUE_FALSE]: questionsToGenerate.trueFalse || 0,
      [QuestionType.URL]: questionsToGenerate.url || 0,
      [QuestionType.UPLOAD]: questionsToGenerate.upload || 0,
      [QuestionType.LINK_FILE]: questionsToGenerate.linkFile || 0,
    };
  }

  private createQuestionBatches(
    questionCounts: CountsByType,
  ): { types: QuestionType[]; counts: number[] }[] {
    const batches: { types: QuestionType[]; counts: number[] }[] = [];

    for (const [typeString, count] of Object.entries(questionCounts)) {
      const type = typeString as QuestionType;
      if (count <= 0) continue;

      let remaining = count;
      while (remaining > 0) {
        const batchSize = Math.min(remaining, this.BATCH_SIZE);
        batches.push({
          types: [type],
          counts: [batchSize],
        });
        remaining -= batchSize;
      }
    }

    return batches;
  }

  private async generateQuestionBatch(
    parameters: BatchGenerationParameters,
  ): Promise<QuestionGenerationResult> {
    const {
      assignmentId,
      types,
      counts,
      difficultyLevel,
      content,
      learningObjectives,
    } = parameters;
    const totalCount = counts.reduce((sum, count) => sum + count, 0);
    let generatedQuestions: IGeneratedQuestion[] = [];
    let success = false;
    const errors: string[] = [];

    // For each attempt
    for (let attempt = 0; attempt < this.MAX_GENERATION_RETRIES; attempt++) {
      try {
        // Create prompt focused on current batch
        const parser = this.createOutputParser(types);
        const prompt = this.createBatchPrompt(
          types,
          counts,
          difficultyLevel,
          content,
          learningObjectives,
          parser.getFormatInstructions(),
        );

        // Process prompt through LLM
        this.logger.debug(
          `Generating questions for assignment ID: ${assignmentId}`,
        );
        const response = await this.promptProcessor.processPrompt(
          prompt,
          assignmentId,
          AIUsageType.ASSIGNMENT_GENERATION,
        );

        // Parse response
        const parsed = (await parser.parse(response)) as {
          questions: IGeneratedQuestion[];
        };
        if (!parsed || !parsed.questions || !Array.isArray(parsed.questions)) {
          throw new Error("Invalid response format");
        }

        // Process and validate questions
        const rawQuestions = parsed.questions;
        const processedQuestions = this.processGeneratedQuestions(
          rawQuestions,
          assignmentId,
        );

        // Create a subset of questionsToGenerate for validation
        const batchRequirements: Partial<EnhancedQuestionsToGenerate> = {};
        for (const [index, type] of types.entries()) {
          const count = counts[index];
          switch (type) {
            case QuestionType.SINGLE_CORRECT: {
              batchRequirements.multipleChoice = count;
              break;
            }
            case QuestionType.MULTIPLE_CORRECT: {
              batchRequirements.multipleSelect = count;
              break;
            }
            case QuestionType.TEXT: {
              batchRequirements.textResponse = count;
              break;
            }
            case QuestionType.TRUE_FALSE: {
              batchRequirements.trueFalse = count;
              break;
            }
            case QuestionType.URL: {
              batchRequirements.url = count;
              break;
            }
            case QuestionType.UPLOAD: {
              batchRequirements.upload = count;
              break;
            }
            case QuestionType.LINK_FILE: {
              batchRequirements.linkFile = count;
              break;
            }
          }
        }

        // Validate the generated questions
        const validationResult = await this.validatorService.validateQuestions(
          assignmentId,
          processedQuestions,
          batchRequirements as EnhancedQuestionsToGenerate,
          difficultyLevel,
          content,
          learningObjectives,
        );

        if (validationResult.isValid) {
          // Apply improvements if available
          generatedQuestions = validationResult.hasImprovements
            ? await this.refineQuestions(
                processedQuestions,
                validationResult.improvements,
                assignmentId,
              )
            : processedQuestions;
          success = true;
          break;
        } else {
          // Store validation issues for potential refinement
          errors.push(
            `Validation failed: ${JSON.stringify(validationResult.issues)}`,
          );

          // Try to regenerate only the failed questions for next attempt
          if (attempt < this.MAX_GENERATION_RETRIES - 1) {
            // Keep successful questions for the next round
            const validIndices = new Set(
              Object.keys(validationResult.issues).map(Number),
            );
            generatedQuestions = processedQuestions.filter(
              (_, index) => !validIndices.has(index),
            );

            // Adjust the prompt based on validation issues
            // This is a simplified approach - in a real system you'd want more sophisticated prompt adjustment
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(
          `Batch generation error (attempt ${attempt + 1}): ${errorMessage}`,
        );
        errors.push(errorMessage);
      }
    }

    // If we failed completely, use template questions as fallback
    if (!success && generatedQuestions.length < totalCount) {
      this.logger.warn("Generation failed, using fallbacks");
      const fallbacks = this.generateFallbackQuestions(
        types,
        counts.map((count) =>
          Math.max(
            0,
            count -
              generatedQuestions.filter((q) => types.includes(q.type)).length,
          ),
        ),
        difficultyLevel,
        assignmentId,
        content,
        learningObjectives,
      );
      generatedQuestions = [...generatedQuestions, ...fallbacks];
    }

    return {
      success,
      questions: generatedQuestions,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private createOutputParser(
    types: QuestionType[],
  ): StructuredOutputParser<any> {
    return StructuredOutputParser.fromZodSchema(
      z.object({
        questions: z.array(
          z.object({
            question: z
              .string()
              .min(10)
              .describe(
                "Clear, specific question text appropriate for the difficulty level",
              ),
            type: z
              .enum(
                types.length === 1
                  ? [types[0]]
                  : [
                      QuestionType.SINGLE_CORRECT,
                      QuestionType.MULTIPLE_CORRECT,
                      QuestionType.TEXT,
                      QuestionType.TRUE_FALSE,
                      QuestionType.URL,
                      QuestionType.UPLOAD,
                      QuestionType.LINK_FILE,
                    ],
              )
              .describe("The question type"),
            responseType: z
              .enum([
                ResponseType.CODE,
                ResponseType.ESSAY,
                ResponseType.REPORT,
                ResponseType.OTHER,
              ])
              .optional()
              .describe("Expected response type"),
            totalPoints: z
              .number()
              .int()
              .min(1)
              .describe("Total points for this question"),
            difficultyLevel: z
              .enum([
                DifficultyLevel.BASIC,
                DifficultyLevel.EASY,
                DifficultyLevel.MEDIUM,
                DifficultyLevel.CHALLENGING,
                DifficultyLevel.ADVANCED,
              ])
              .describe("Difficulty level of this question"),
            maxWords: z
              .number()
              .int()
              .positive()
              .optional()
              .describe("Maximum word limit for text responses"),
            maxCharacters: z
              .number()
              .int()
              .positive()
              .optional()
              .describe("Maximum character limit for text responses"),
            randomizedChoices: z
              .boolean()
              .optional()
              .describe("Whether choices should be randomized"),
            scoring: z
              .object({
                type: z
                  .enum([ScoringType.CRITERIA_BASED])
                  .describe("Scoring type"),
                rubrics: z
                  .array(
                    z.object({
                      rubricQuestion: z
                        .string()
                        .min(5)
                        .describe(
                          "Question evaluating a key aspect of response",
                        ),
                      criteria: z
                        .array(
                          z.object({
                            description: z
                              .string()
                              .min(10)
                              .describe("Detailed description of criterion"),
                            points: z
                              .number()
                              .int()
                              .min(0)
                              .describe("Whole point value - higher = better"),
                          }),
                        )
                        .min(3)
                        .max(5)
                        .describe("3-5 criteria with different point values"),
                      showRubricsToLearner: z
                        .boolean()
                        .optional()
                        .describe("Whether to show rubrics to learner"),
                    }),
                  )
                  .min(1)
                  .describe("Array of rubric questions with criteria"),
              })
              .nullable()
              .optional(),
            choices: z
              .array(
                z.object({
                  choice: z
                    .string()
                    .describe("Answer choice text, must match isCorrect")
                    .min(1),
                  id: z.number().describe("Unique identifier for the choice"),
                  isCorrect: z
                    .boolean()
                    .describe("Is this the correct answer?"),
                  points: z
                    .number()
                    .int()
                    .describe("Points assigned for this choice"),
                  feedback: z
                    .string()
                    .optional()
                    .describe("Feedback for this choice"),
                }),
              )
              .nullable()
              .optional()
              .describe("Answer choices"),
          }),
        ),
      }),
    );
  }

  private createBatchPrompt(
    types: QuestionType[],
    counts: number[],
    difficultyLevel: DifficultyLevel,
    content?: string,
    learningObjectives?: string,
    formatInstructions?: string,
  ): PromptTemplate {
    const questionTypeInstructions: string[] = [];
    const typeMap = {
      [QuestionType.SINGLE_CORRECT]: "MULTIPLE_CHOICE",
      [QuestionType.MULTIPLE_CORRECT]: "MULTIPLE_SELECT",
      [QuestionType.TEXT]: "TEXT_RESPONSE",
      [QuestionType.TRUE_FALSE]: "TRUE_FALSE",
      [QuestionType.URL]: "URL",
      [QuestionType.UPLOAD]: "UPLOAD",
      [QuestionType.LINK_FILE]: "LINK_FILE",
    };

    // Generate type-specific instructions
    for (const [index, type] of types.entries()) {
      const count = counts[index];

      switch (type) {
        case QuestionType.SINGLE_CORRECT: {
          questionTypeInstructions.push(`
  Generate ${count} MULTIPLE_CHOICE (SINGLE_CORRECT) questions:
  - Include exactly 4 choices for each question
  - One choice must be clearly correct (1 point)
  - All incorrect choices must have 0 points
  - Distractors should be plausible (not obviously wrong)
  - Each choice must have detailed feedback explaining why it is correct/incorrect
`);
          break;
        }

        case QuestionType.MULTIPLE_CORRECT: {
          questionTypeInstructions.push(`
  Generate ${count} MULTIPLE_SELECT (MULTIPLE_CORRECT) questions:
  - Include exactly 4 choices for each question
  - 2 choices must be correct (1 point each), 2 incorrect (-1 points each)
  - All correct choices are required for full points
  - Each choice must have detailed feedback
`);
          break;
        }

        case QuestionType.TEXT: {
          questionTypeInstructions.push(`
     Generate ${count} TEXT_RESPONSE questions:
        - Clear, specific prompt requiring detailed explanation
        - Include word/character limits appropriate to difficulty
        - Comprehensive rubric with 3 criteria, each with 4 levels
        - Criteria should focus on: Content Accuracy, Critical Thinking, and Organization
      `);
          break;
        }

        case QuestionType.TRUE_FALSE: {
          questionTypeInstructions.push(`
  Generate ${count} TRUE_FALSE questions:
  - Clear, unambiguous statements that are definitively true or false
  - Test significant concepts, not trivia
  - Provide only a SINGLE choice for each TRUE/FALSE question
  - For true statements: set "choice" to "true", "isCorrect" to true, and "points" to 1
  - For false statements: set "choice" to "false", "isCorrect" to false, and "points" to 0
  - Include detailed feedback explaining why the statement is true or false
`);
          break;
        }

        case QuestionType.URL:
        case QuestionType.UPLOAD:
        case QuestionType.LINK_FILE: {
          questionTypeInstructions.push(`
     Generate ${count} ${typeMap[type]} questions:
        - Clear expectations about what to submit
        - Detailed rubric with criteria specific to the expected submission
        - Appropriate response type setting
      `);
          break;
        }
      }
    }

    // Extract content samples
    const contentSample = content ? content.slice(0, 500) : "";
    const objectivesSample = learningObjectives || "";

    const template = `
You are an expert teacher creating high-quality assessment questions at specific difficulty levels.

DIFFICULTY LEVEL: {difficultyLevel}
DIFFICULTY DESCRIPTION: {difficultyDescription}

{contentSection}
{objectivesSection}

QUESTION GENERATION REQUIREMENTS:
{questionTypeInstructions}

QUALITY REQUIREMENTS:
- Points MUST be whole numbers only (integers, not decimals)
- For SINGLE_CORRECT and TRUE_FALSE questions: Total points = 1
- For MULTIPLE_CORRECT questions: Each correct choice = 1 point, incorrect choices = -1 point
- Questions must directly relate to the provided content/objectives
- All questions MUST match the specified difficulty level exactly
- Use clear, precise language with no grammatical errors
- Each question should focus on a different aspect of the material
{difficultyGuidance}

FORMAT INSTRUCTIONS:
{formatInstructions}
`;

    return new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        difficultyLevel: () => difficultyLevel.toString(),
        difficultyDescription: () =>
          this.getDifficultyDescription(difficultyLevel),
        contentSection: () =>
          content
            ? `CONTENT SAMPLE:\n${contentSample}${
                content.length > 500 ? "..." : ""
              }`
            : "",
        objectivesSection: () =>
          learningObjectives ? `LEARNING OBJECTIVES:\n${objectivesSample}` : "",
        questionTypeInstructions: () => questionTypeInstructions.join("\n"),
        difficultyGuidance: () =>
          this.getDifficultyGuidanceForLevel(difficultyLevel),
        formatInstructions: () => formatInstructions || "",
      },
    });
  }

  private processGeneratedQuestions(
    rawQuestions: IGeneratedQuestion[],
    assignmentId: number,
  ): IGeneratedQuestion[] {
    return rawQuestions.map((question, index) => ({
      id: Math.floor(Math.random() * 1_000_000) + index, // Generate a safer ID within 32-bit integer range
      assignmentId,
      question: question.question?.replaceAll("```", "").trim(),
      totalPoints: question.totalPoints || this.getDefaultPoints(question.type),
      type: question.type,
      responseType: question.responseType || this.getDefaultResponseType(),
      difficultyLevel: question.difficultyLevel,
      maxWords:
        question.maxWords ||
        this.getDefaultMaxWords(question.type, question.difficultyLevel),
      maxCharacters:
        question.maxCharacters ||
        this.getDefaultMaxCharacters(question.type, question.difficultyLevel),
      randomizedChoices:
        question.randomizedChoices ??
        (question.type === QuestionType.SINGLE_CORRECT ||
          question.type === QuestionType.MULTIPLE_CORRECT),
      scoring:
        question.scoring ??
        (this.needsRubric(question.type)
          ? this.getDefaultScoring(question.type, question.difficultyLevel)
          : undefined),
      choices: this.processChoices(question),
    }));
  }
  private processChoices(question: IGeneratedQuestion): Choice[] | undefined {
    if (question.type === QuestionType.TRUE_FALSE) {
      if (!question.choices || question.choices.length !== 1) {
        return [
          {
            id: 1,
            choice: "true",
            isCorrect: true,
            points: 1, // Always 1 point for correct answer
            feedback: "This statement is correct based on the concept.",
          },
        ];
      }

      const originalChoice = question.choices[0];
      const choiceText = originalChoice.choice?.toLowerCase().trim();
      const isStatementTrue = choiceText === "true";

      return [
        {
          id: 1,
          choice: isStatementTrue ? "true" : "false",
          isCorrect: isStatementTrue,
          points: isStatementTrue ? originalChoice.points || 1 : 0,
          feedback:
            originalChoice.feedback?.replaceAll("```", "").trim() ||
            (isStatementTrue
              ? "This statement is correct."
              : "This statement is incorrect."),
        },
      ];
    }

    if (!question.choices) {
      return this.getDefaultChoices(question.type, question.difficultyLevel);
    }

    return question.choices.map((choice: Choice, index: number) => ({
      choice: choice.choice?.replaceAll("```", "").trim() || "",
      id: choice.id || index + 1,
      isCorrect: choice.isCorrect === true,
      points:
        choice.points === undefined
          ? choice.isCorrect
            ? 1
            : 0
          : Math.round(choice.points),
      feedback:
        choice.feedback?.replaceAll("```", "").trim() ||
        (choice.isCorrect
          ? "This is the correct answer."
          : "This is not the correct answer."),
    }));
  }

  private async refineQuestions(
    questions: IGeneratedQuestion[],
    improvements: Record<number, string>,
    assignmentId: number,
  ): Promise<IGeneratedQuestion[]> {
    const refinedQuestions = [...questions];
    const refinementPromises: Promise<void>[] = [];

    for (const [index, improvement] of Object.entries(improvements)) {
      const questionIndex = Number.parseInt(index, 10);
      if (
        Number.isNaN(questionIndex) ||
        questionIndex < 0 ||
        questionIndex >= questions.length
      ) {
        continue;
      }

      const questionToImprove = questions[questionIndex];

      const refinementPromise = (async () => {
        try {
          const improvedQuestion = await this.refineIndividualQuestion(
            questionToImprove,
            improvement,
            assignmentId,
          );

          refinedQuestions[questionIndex] = {
            ...questionToImprove,
            ...improvedQuestion,
          };
        } catch (error) {
          this.logger.warn(
            `Failed to refine question ${questionIndex}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
          // Keep the original if refinement fails
        }
      })();

      refinementPromises.push(refinementPromise);
    }

    // Wait for all refinements to complete
    await Promise.all(refinementPromises);
    return refinedQuestions;
  }

  private async refineIndividualQuestion(
    question: IGeneratedQuestion,
    improvement: string,
    assignmentId: number,
  ): Promise<Partial<IGeneratedQuestion>> {
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        question: z.string().min(10).optional(),
        choices: z
          .array(
            z.object({
              choice: z.string().min(1),
              id: z.number().int().min(1),
              isCorrect: z.boolean(),
              points: z.number().int().min(0),
              feedback: z.string().min(5).optional(),
            }),
          )
          .nullable()
          .optional(),
        scoring: z
          .object({
            type: z.literal(ScoringType.CRITERIA_BASED),
            rubrics: z.array(
              z.object({
                rubricQuestion: z.string(),
                criteria: z.array(
                  z.object({
                    description: z.string(),
                    points: z.number(),
                  }),
                ),
              }),
            ),
          })
          .optional(),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const template = `
    You are tasked with improving a specific question based on feedback.
    
    ORIGINAL QUESTION:
    {originalQuestion}
    
    IMPROVEMENT NEEDED:
    {improvement}
    
    Your task:
    1. Apply the suggested improvement to the question
    2. Only return the parts of the question that need to be changed
    3. Ensure the improved version maintains the same difficulty level and core testing concept
    
    {formatInstructions}
    `;
    const response = await this.promptProcessor.processPrompt(
      new PromptTemplate({
        template,
        inputVariables: [],
        partialVariables: {
          formatInstructions: () => formatInstructions,
          improvement: () => improvement,
          originalQuestion: () =>
            JSON.stringify(question, null, 2) || "No question provided",
        },
      }),
      assignmentId,
      AIUsageType.ASSIGNMENT_GENERATION,
    );
    const parsedResponse = await parser.parse(response);
    if (parsedResponse.scoring) {
      parsedResponse.scoring.type = ScoringType.CRITERIA_BASED;
    }
    return parsedResponse as Partial<IGeneratedQuestion>;
  }

  private finalizeQuestionSet(
    questions: IGeneratedQuestion[],
    requiredCounts: CountsByType,
    assignmentId: number,
    difficultyLevel: DifficultyLevel,
    content?: string,
    learningObjectives?: string,
  ): IGeneratedQuestion[] {
    // Group questions by type
    const questionsByType: Record<QuestionType, IGeneratedQuestion[]> =
      {} as Record<QuestionType, IGeneratedQuestion[]>;

    // Initialize with empty arrays
    for (const type of Object.values(QuestionType)) {
      questionsByType[type] = [];
    }

    // Group questions
    for (const question of questions) {
      if (!questionsByType[question.type]) {
        questionsByType[question.type] = [];
      }
      questionsByType[question.type].push(question);
    }

    const finalQuestions: IGeneratedQuestion[] = [];

    // For each required type
    for (const [typeString, requiredCount] of Object.entries(requiredCounts)) {
      const type = typeString as QuestionType;
      if (requiredCount <= 0) continue;

      // Sort available questions by quality
      const availableQuestions = this.sortQuestionsByQuality(
        questionsByType[type],
      );

      // Take the best ones
      const selectedQuestions = availableQuestions.slice(0, requiredCount);

      // If we don't have enough, create fallbacks
      if (selectedQuestions.length < requiredCount) {
        const missingCount = requiredCount - selectedQuestions.length;
        const fallbacks = this.generateFallbackQuestionsOfType(
          type,
          missingCount,
          difficultyLevel,
          assignmentId,
          content,
          learningObjectives,
        );

        selectedQuestions.push(...fallbacks);
      }

      finalQuestions.push(...selectedQuestions);
    }

    // Ensure unique IDs
    return finalQuestions.map((q, index) => ({
      ...q,
      id: q.id || Date.now() + index,
      assignmentId: assignmentId,
    }));
  }

  private sortQuestionsByQuality(
    questions: IGeneratedQuestion[],
  ): IGeneratedQuestion[] {
    return [...questions].sort((a, b) => {
      // Sort by quality heuristics

      // Prioritize questions without issues
      const aHasIssues = this.questionHasIssues(a);
      const bHasIssues = this.questionHasIssues(b);

      if (aHasIssues !== bHasIssues) {
        return aHasIssues ? 1 : -1;
      }

      // Next, prefer non-template questions
      const aIsTemplate = this.isTemplateQuestion(a);
      const bIsTemplate = this.isTemplateQuestion(b);

      if (aIsTemplate !== bIsTemplate) {
        return aIsTemplate ? 1 : -1;
      }

      // Finally, prefer longer questions (assuming more detailed)
      return (b.question?.length || 0) - (a.question?.length || 0);
    });
  }

  private isTemplateQuestion(question: IGeneratedQuestion): boolean {
    return (
      !question.question ||
      question.question.includes("template") ||
      question.question.includes("[") ||
      question.question.length < 20
    );
  }

  private questionHasIssues(question: IGeneratedQuestion): boolean {
    if (!question.question || question.question.length < 15) {
      return true;
    }

    if (question.type === QuestionType.TRUE_FALSE) {
      if (!question.choices || question.choices.length !== 1) {
        return true;
      }

      const choice = question.choices[0];
      const choiceValue = choice.choice?.toString().toLowerCase().trim();
      if (choiceValue !== "true" && choiceValue !== "false") {
        return true;
      }

      const isStatementTrue = choiceValue === "true";
      if (choice.isCorrect !== isStatementTrue) {
        return true;
      }

      if (!choice.feedback || choice.feedback.length < 5) {
        return true;
      }

      return false;
    }

    if (
      question.type === QuestionType.SINGLE_CORRECT ||
      question.type === QuestionType.MULTIPLE_CORRECT
    ) {
      if (!question.choices || question.choices.length < 2) {
        return true;
      }

      if (!question.choices.some((c) => c.isCorrect)) {
        return true;
      }

      if (
        question.type === QuestionType.SINGLE_CORRECT &&
        question.choices.filter((c) => c.isCorrect).length !== 1
      ) {
        return true;
      }

      if (question.choices.some((c) => !c.feedback || c.feedback.length < 5)) {
        return true;
      }

      // Check for duplicate choices
      const choiceTexts = question.choices.map((c) =>
        c.choice?.toLowerCase().trim(),
      );
      if (new Set(choiceTexts).size !== choiceTexts.length) {
        return true;
      }
    }

    if (
      question.type === QuestionType.TEXT ||
      question.type === QuestionType.URL ||
      question.type === QuestionType.UPLOAD ||
      question.type === QuestionType.LINK_FILE
    ) {
      if (
        !question.scoring ||
        !question.scoring.rubrics ||
        question.scoring.rubrics.length === 0
      ) {
        return true;
      }

      for (const rubric of question.scoring.rubrics) {
        if (!rubric.criteria || rubric.criteria.length < 2) {
          return true;
        }

        // Check for duplicate point values
        const points = rubric.criteria.map((c) => c.points);
        if (new Set(points).size !== points.length) {
          return true;
        }
      }
    }

    return false;
  }

  private generateFallbackQuestions(
    types: QuestionType[],
    counts: number[],
    difficultyLevel: DifficultyLevel,
    assignmentId: number,
    content?: string,
    learningObjectives?: string,
  ): IGeneratedQuestion[] {
    const fallbacks: IGeneratedQuestion[] = [];

    for (const [index, type] of types.entries()) {
      const count = counts[index];

      if (count > 0) {
        fallbacks.push(
          ...this.generateFallbackQuestionsOfType(
            type,
            count,
            difficultyLevel,
            assignmentId,
            content,
            learningObjectives,
          ),
        );
      }
    }

    return fallbacks;
  }

  private generateFallbackQuestionsOfType(
    type: QuestionType,
    count: number,
    difficultyLevel: DifficultyLevel,
    assignmentId: number,
    content?: string,
    learningObjectives?: string,
  ): IGeneratedQuestion[] {
    const fallbacks: IGeneratedQuestion[] = [];
    const keyTerms = this.extractKeyTerms(content, learningObjectives);

    for (let index = 0; index < count; index++) {
      fallbacks.push(
        this.createEnhancedTemplateQuestion(
          type,
          difficultyLevel,
          keyTerms,
          assignmentId,
          index + 1, // Use small sequential integers as IDs
        ),
      );
    }

    return fallbacks;
  }

  private extractKeyTerms(
    content?: string,
    learningObjectives?: string,
  ): string[] {
    if (!content && !learningObjectives) {
      return ["the subject"];
    }

    const combinedText = [content, learningObjectives]
      .filter(Boolean)
      .join(" ");
    const termSet = new Set<string>();

    // Extract capitalized terms (potential key concepts)
    const matches =
      combinedText.match(/[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}/g) || [];
    for (const match of matches) {
      if (
        ![
          "The",
          "This",
          "That",
          "These",
          "Those",
          "When",
          "Where",
          "Why",
          "How",
        ].includes(match)
      ) {
        termSet.add(match);
      }
    }

    // If we have less than 3 terms, find common words
    if (termSet.size < 3) {
      const words = combinedText.toLowerCase().split(/\s+/);
      const wordCounts: Record<string, number> = {};

      for (const word of words) {
        if (word.length > 4) {
          wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
      }

      const topWords = Object.entries(wordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map((entry) => entry[0]);

      for (const word of topWords) {
        termSet.add(word);
      }
    }

    return [...termSet].slice(0, 5);
  }

  private createEnhancedTemplateQuestion(
    type: QuestionType,
    difficultyLevel: DifficultyLevel,
    keyTerms: string[],
    assignmentId: number,
    id?: number,
  ): IGeneratedQuestion {
    const questionId = id || Math.floor(Math.random() * 1_000_000);
    const term = keyTerms.length > 0 ? keyTerms[0] : "the concept";
    const levelText = difficultyLevel.toString().toLowerCase();

    // Create question text based on type and key terms
    let questionText: string;

    switch (type) {
      case QuestionType.SINGLE_CORRECT: {
        questionText = `Which of the following best describes ${term}?`;
        break;
      }
      case QuestionType.MULTIPLE_CORRECT: {
        questionText = `Select all of the following that correctly describe ${term}.`;
        break;
      }
      case QuestionType.TRUE_FALSE: {
        questionText = `True or False: ${term} is an important concept that is central to understanding this subject.`;
        break;
      }
      case QuestionType.TEXT: {
        questionText = `Explain the concept of ${term} in detail, including its significance and applications.`;
        break;
      }
      case QuestionType.URL: {
        questionText = `Find and provide a URL to a resource that thoroughly explains ${term}.`;
        break;
      }
      case QuestionType.UPLOAD: {
        questionText = `Create and upload a document that explains ${term} at a ${levelText} level of understanding.`;
        break;
      }
      case QuestionType.LINK_FILE: {
        questionText = `Provide a link to a file that contains detailed information about ${term}.`;
        break;
      }
      default: {
        questionText = `Answer the following question about ${term} at a ${levelText} level.`;
      }
    }

    const baseQuestion: IGeneratedQuestion = {
      id: questionId,
      assignmentId,
      question: questionText,
      totalPoints: this.getDefaultPoints(type, difficultyLevel),
      type: type,
      responseType: this.getDefaultResponseType(),
      difficultyLevel: difficultyLevel,
      scoring: this.getDefaultScoring(type, difficultyLevel),
    };

    // Add type-specific properties
    switch (type) {
      case QuestionType.SINGLE_CORRECT: {
        return {
          ...baseQuestion,
          randomizedChoices: true,
          choices: this.createContentRelevantChoices(
            type,
            difficultyLevel,
            term,
          ),
        };
      }

      case QuestionType.MULTIPLE_CORRECT: {
        return {
          ...baseQuestion,
          randomizedChoices: true,
          choices: this.createContentRelevantChoices(
            type,
            difficultyLevel,
            term,
          ),
        };
      }

      case QuestionType.TRUE_FALSE: {
        return {
          ...baseQuestion,
          choices: [
            {
              id: 1,
              choice: "true",
              isCorrect: true,
              points: 1,
              feedback: `This statement is correct. ${term} is indeed central to understanding this subject.`,
            },
          ],
        };
      }

      case QuestionType.TEXT: {
        return {
          ...baseQuestion,
          maxWords: this.getDefaultMaxWords(type, difficultyLevel),
          maxCharacters: this.getDefaultMaxCharacters(type, difficultyLevel),
          scoring: this.createContentRelevantScoring(
            type,
            difficultyLevel,
            term,
          ),
        };
      }

      case QuestionType.URL:
      case QuestionType.UPLOAD:
      case QuestionType.LINK_FILE: {
        return {
          ...baseQuestion,
          scoring: this.createContentRelevantScoring(
            type,
            difficultyLevel,
            term,
          ),
        };
      }

      default: {
        return baseQuestion;
      }
    }
  }
  private createContentRelevantChoices(
    type: QuestionType,
    difficultyLevel: DifficultyLevel,
    term: string,
  ): Choice[] {
    switch (type) {
      case QuestionType.SINGLE_CORRECT: {
        return [
          {
            id: 1,
            choice: `${term} is a fundamental concept that forms the foundation of this subject area.`,
            isCorrect: true,
            points: 1, // Always 1 point
            feedback: `This is correct. ${term} is indeed a fundamental concept in this subject area.`,
          },
          {
            id: 2,
            choice: `${term} is a minor concept that has limited relevance to this subject area.`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. ${term} is not a minor concept but rather central to this subject area.`,
          },
          {
            id: 3,
            choice: `${term} contradicts the main principles discussed in this subject area.`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. ${term} supports rather than contradicts the main principles of this subject area.`,
          },
          {
            id: 4,
            choice: `${term} is unrelated to this subject area and belongs to a different discipline altogether.`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. ${term} is directly related to this subject area, not a concept from a different discipline.`,
          },
        ];
      }

      case QuestionType.MULTIPLE_CORRECT: {
        return [
          {
            id: 1,
            choice: `${term} is essential for understanding the core principles of this subject.`,
            isCorrect: true,
            points: 1, // Each correct choice gets 1 point
            feedback: `This is correct. ${term} is essential for understanding this subject's core principles.`,
          },
          {
            id: 2,
            choice: `${term} has practical applications in real-world scenarios related to this subject.`,
            isCorrect: true,
            points: 1, // Each correct choice gets 1 point
            feedback: `This is correct. ${term} does have important real-world applications in this field.`,
          },
          {
            id: 3,
            choice: `${term} is considered outdated and no longer relevant to modern understanding of this subject.`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. ${term} remains highly relevant to the modern understanding of this subject.`,
          },
          {
            id: 4,
            choice: `${term} primarily contradicts the established theories in this subject area.`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. ${term} supports rather than contradicts established theories in this subject.`,
          },
        ];
      }

      default: {
        return [];
      }
    }
  }
  private createContentRelevantScoring(
    type: QuestionType,
    difficultyLevel: DifficultyLevel,
    term: string,
  ): ScoringDto {
    const levelText = difficultyLevel.toString().toLowerCase();

    const baseRubric: ScoringDto = {
      type: ScoringType.CRITERIA_BASED,
      showRubricsToLearner: true,
      rubrics: [
        {
          rubricQuestion: `Understanding of ${term}`,
          criteria: [
            {
              description: `Excellent - Demonstrates comprehensive understanding of ${term} at ${levelText} level`,
              points: 5,
            },
            {
              description: `Good - Shows solid understanding of ${term} with minor gaps`,
              points: 3,
            },
            {
              description: `Fair - Shows basic understanding of ${term} with significant gaps`,
              points: 1,
            },
            {
              description: `Poor - Shows minimal or incorrect understanding of ${term}`,
              points: 0,
            },
          ],
        },
        {
          rubricQuestion: "Application and Analysis",
          criteria: [
            {
              description: `Excellent - Applies concepts of ${term} with insightful analysis`,
              points: 5,
            },
            {
              description: `Good - Applies concepts of ${term} with sound reasoning`,
              points: 3,
            },
            {
              description: `Fair - Shows basic application with limited analysis`,
              points: 1,
            },
            {
              description: `Poor - Fails to apply concepts effectively`,
              points: 0,
            },
          ],
        },
      ],
    };

    // Add a third rubric based on question type
    switch (type) {
      case QuestionType.TEXT: {
        baseRubric.rubrics.push({
          rubricQuestion: "Organization and Clarity",
          criteria: [
            {
              description:
                "Excellent - Well-structured with clear, precise language",
              points: 5,
            },
            {
              description: "Good - Generally organized with clear expression",
              points: 3,
            },
            {
              description:
                "Fair - Somewhat disorganized with some clarity issues",
              points: 1,
            },
            {
              description: "Poor - Poorly organized and difficult to follow",
              points: 0,
            },
          ],
        });
        break;
      }

      case QuestionType.URL: {
        baseRubric.rubrics.push({
          rubricQuestion: "Resource Quality",
          criteria: [
            {
              description: `Excellent - Authoritative source with comprehensive information about ${term}`,
              points: 5,
            },
            {
              description: `Good - Reliable source with relevant information about ${term}`,
              points: 3,
            },
            {
              description: `Fair - Basic source with limited information about ${term}`,
              points: 1,
            },
            {
              description: "Poor - Unreliable or irrelevant source",
              points: 0,
            },
          ],
        });
        break;
      }

      case QuestionType.UPLOAD:
      case QuestionType.LINK_FILE: {
        baseRubric.rubrics.push({
          rubricQuestion: "Document Quality",
          criteria: [
            {
              description: `Excellent - Comprehensive, well-formatted document addressing ${term}`,
              points: 5,
            },
            {
              description: `Good - Complete document with good coverage of ${term}`,
              points: 3,
            },
            {
              description: `Fair - Basic document with limited coverage of ${term}`,
              points: 1,
            },
            {
              description: "Poor - Incomplete or poorly formatted document",
              points: 0,
            },
          ],
        });
        break;
      }
    }

    return baseRubric;
  }

  private mapAssignmentTypeToDifficulty(
    assignmentType: AssignmentTypeEnum,
  ): DifficultyLevel {
    switch (assignmentType) {
      case AssignmentTypeEnum.PRACTICE: {
        return DifficultyLevel.BASIC;
      }
      case AssignmentTypeEnum.QUIZ:
      case AssignmentTypeEnum.HOMEWORK: {
        return DifficultyLevel.EASY;
      }
      case AssignmentTypeEnum.ASSIGNMENT:
      case AssignmentTypeEnum.LAB: {
        return DifficultyLevel.MEDIUM;
      }
      case AssignmentTypeEnum.MIDTERM:
      case AssignmentTypeEnum.TEST: {
        return DifficultyLevel.CHALLENGING;
      }
      case AssignmentTypeEnum.FINAL:
      case AssignmentTypeEnum.EXAM: {
        return DifficultyLevel.ADVANCED;
      }
      default: {
        return DifficultyLevel.MEDIUM;
      }
    }
  }
  private getDefaultPoints(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): number {
    switch (questionType) {
      case QuestionType.SINGLE_CORRECT:
      case QuestionType.MULTIPLE_CORRECT:
      case QuestionType.TRUE_FALSE: {
        return 1;
      }
      case QuestionType.TEXT: {
        switch (difficultyLevel) {
          case DifficultyLevel.BASIC: {
            return 5;
          }
          case DifficultyLevel.EASY: {
            return 7;
          }
          case DifficultyLevel.MEDIUM: {
            return 10;
          }
          case DifficultyLevel.CHALLENGING: {
            return 15;
          }
          default: {
            return 20;
          }
        }
      }
      case QuestionType.URL:
      case QuestionType.UPLOAD:
      case QuestionType.LINK_FILE: {
        switch (difficultyLevel) {
          case DifficultyLevel.BASIC: {
            return 5;
          }
          case DifficultyLevel.EASY: {
            return 8;
          }
          case DifficultyLevel.MEDIUM: {
            return 10;
          }
          case DifficultyLevel.CHALLENGING: {
            return 12;
          }
          default: {
            return 15;
          }
        }
      }
      default: {
        return 5;
      }
    }
  }

  private getDefaultMaxWords(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): number | undefined {
    if (questionType === QuestionType.TEXT) {
      switch (difficultyLevel) {
        case DifficultyLevel.BASIC: {
          return 150;
        }
        case DifficultyLevel.EASY: {
          return 250;
        }
        case DifficultyLevel.MEDIUM: {
          return 400;
        }
        case DifficultyLevel.CHALLENGING: {
          return 600;
        }
        default: {
          return 800;
        }
      }
    }
    return undefined;
  }

  private getDefaultMaxCharacters(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): number | undefined {
    if (questionType === QuestionType.TEXT) {
      switch (difficultyLevel) {
        case DifficultyLevel.BASIC: {
          return 1000;
        }
        case DifficultyLevel.EASY: {
          return 1500;
        }
        case DifficultyLevel.MEDIUM: {
          return 2500;
        }
        case DifficultyLevel.CHALLENGING: {
          return 3500;
        }
        default: {
          return 5000;
        }
      }
    }
    return undefined;
  }

  private getDefaultResponseType(): ResponseType {
    return ResponseType.OTHER;
  }
  private getDefaultChoices(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): Choice[] | undefined {
    const levelText = difficultyLevel?.toString().toLowerCase() || "medium";

    switch (questionType) {
      case QuestionType.SINGLE_CORRECT: {
        return [
          {
            id: 1,
            choice: `This is the correct answer with appropriate ${levelText}-level complexity`,
            isCorrect: true,
            points: 1, // Always 1 point
            feedback: `This is correct. It demonstrates understanding at the ${levelText} level.`,
          },
          {
            id: 2,
            choice: `This is a plausible but incorrect answer`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. It represents a common misconception.`,
          },
          {
            id: 3,
            choice: `This is another plausible but incorrect answer`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. While it contains some truth, it misses critical elements.`,
          },
          {
            id: 4,
            choice: `This is a clearly incorrect answer`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. It shows a fundamental misunderstanding of the concept.`,
          },
        ];
      }
      case QuestionType.MULTIPLE_CORRECT: {
        return [
          {
            id: 1,
            choice: `This is the first correct answer`,
            isCorrect: true,
            points: 1, // Each correct choice gets 1 point
            feedback: `This is correct. It accurately describes one aspect of the concept.`,
          },
          {
            id: 2,
            choice: `This is the second correct answer`,
            isCorrect: true,
            points: 1, // Each correct choice gets 1 point
            feedback: `This is also correct. It captures another important aspect.`,
          },
          {
            id: 3,
            choice: `This is a plausible but incorrect answer`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. It seems plausible but misrepresents the concept.`,
          },
          {
            id: 4,
            choice: `This is another plausible but incorrect answer`,
            isCorrect: false,
            points: 0,
            feedback: `This is incorrect. It represents a common misconception.`,
          },
        ];
      }
      case QuestionType.TRUE_FALSE: {
        return [
          {
            id: 1,
            choice: "true",
            isCorrect: true,
            points: 1, // Always 1 point
            feedback: `This statement is correct based on the concept.`,
          },
        ];
      }
      default: {
        return undefined;
      }
    }
  }

  private needsRubric(questionType: QuestionType): boolean {
    return (
      questionType === QuestionType.TEXT ||
      questionType === QuestionType.URL ||
      questionType === QuestionType.UPLOAD ||
      questionType === QuestionType.LINK_FILE
    );
  }

  private getDefaultScoring(
    questionType: QuestionType,
    difficultyLevel?: DifficultyLevel,
  ): ScoringDto {
    const levelText = difficultyLevel?.toString().toLowerCase() || "medium";

    switch (questionType) {
      case QuestionType.TEXT: {
        return {
          type: ScoringType.CRITERIA_BASED,
          showRubricsToLearner: true,
          rubrics: [
            {
              rubricQuestion: "Content Accuracy and Comprehensiveness",
              criteria: [
                {
                  description: `Excellent - Complete and accurate answer demonstrating ${levelText} understanding with comprehensive details`,
                  points: 5,
                },
                {
                  description: `Good - Mostly accurate with minor omissions, showing adequate ${levelText} understanding`,
                  points: 3,
                },
                {
                  description: `Fair - Partially accurate with significant gaps in ${levelText} understanding`,
                  points: 1,
                },
                {
                  description: `Poor - Mostly incorrect or off-topic, lacking ${levelText} understanding`,
                  points: 0,
                },
              ],
            },
            {
              rubricQuestion: "Critical Thinking and Analysis",
              criteria: [
                {
                  description: `Excellent - Demonstrates exceptional critical analysis appropriate for ${levelText} level`,
                  points: 5,
                },
                {
                  description: `Good - Shows solid analytical thinking with some ${levelText} depth`,
                  points: 3,
                },
                {
                  description: `Fair - Exhibits basic analysis with limited ${levelText} depth`,
                  points: 1,
                },
                {
                  description: `Poor - Shows minimal or no analytical thinking at ${levelText} level`,
                  points: 0,
                },
              ],
            },
            {
              rubricQuestion: "Organization and Clarity",
              criteria: [
                {
                  description: `Excellent - Well-structured with clear, logical flow and precise language at ${levelText} level`,
                  points: 5,
                },
                {
                  description: `Good - Generally organized with mostly clear expression at ${levelText} level`,
                  points: 3,
                },
                {
                  description: `Fair - Somewhat disorganized with clarity issues at ${levelText} level`,
                  points: 1,
                },
                {
                  description: `Poor - Poorly organized and difficult to follow at ${levelText} level`,
                  points: 0,
                },
              ],
            },
          ],
        };
      }
      case QuestionType.URL:
      case QuestionType.UPLOAD:
      case QuestionType.LINK_FILE: {
        return {
          type: ScoringType.CRITERIA_BASED,
          showRubricsToLearner: true,
          rubrics: [
            {
              rubricQuestion: "Relevance to Question",
              criteria: [
                {
                  description: `Excellent - Directly addresses the question with specific details at ${levelText} level`,
                  points: 5,
                },
                {
                  description: `Good - Mostly relevant with minor tangents at ${levelText} level`,
                  points: 3,
                },
                {
                  description: `Fair - Somewhat relevant but with major gaps at ${levelText} level`,
                  points: 1,
                },
                {
                  description: `Poor - Not relevant to the question at ${levelText} level`,
                  points: 0,
                },
              ],
            },
            {
              rubricQuestion: "Quality and Depth of Content",
              criteria: [
                {
                  description: `Excellent - High-quality, comprehensive content with insightful ${levelText}-level analysis`,
                  points: 5,
                },
                {
                  description: `Good - Good quality content with some ${levelText}-level insights`,
                  points: 3,
                },
                {
                  description: `Fair - Basic content that meets minimum ${levelText}-level requirements`,
                  points: 1,
                },
                {
                  description: `Poor - Low-quality or insufficient content for ${levelText} level`,
                  points: 0,
                },
              ],
            },
            {
              rubricQuestion: "Professional Presentation",
              criteria: [
                {
                  description: `Excellent - Professional, well-formatted presentation at ${levelText} level`,
                  points: 5,
                },
                {
                  description: `Good - Generally professional presentation with minor issues at ${levelText} level`,
                  points: 3,
                },
                {
                  description: `Fair - Basic presentation with notable issues at ${levelText} level`,
                  points: 1,
                },
                {
                  description: `Poor - Poor presentation unsuitable for ${levelText} level`,
                  points: 0,
                },
              ],
            },
          ],
        };
      }
      default: {
        return {
          type: ScoringType.CRITERIA_BASED,
          rubrics: [],
        };
      }
    }
  }

  private getDifficultyDescription(difficultyLevel: DifficultyLevel): string {
    switch (difficultyLevel) {
      case DifficultyLevel.BASIC: {
        return "Basic level - Tests recall and basic comprehension of fundamental concepts. Questions focus on definition, identification, and simple applications with straightforward answers.";
      }
      case DifficultyLevel.EASY: {
        return "Easy level - Tests understanding of concepts and simple applications. Questions require comprehension and basic problem-solving with clearly defined parameters.";
      }
      case DifficultyLevel.MEDIUM: {
        return "Medium level - Tests application and analysis of concepts. Questions require deeper understanding, ability to connect concepts, and solving problems with some complexity.";
      }
      case DifficultyLevel.CHALLENGING: {
        return "Challenging level - Tests evaluation and synthesis of concepts. Questions require critical thinking, comparing different approaches, and solving complex problems with multiple variables.";
      }
      case DifficultyLevel.ADVANCED: {
        return "Advanced level - Tests creation and innovation based on deep understanding. Questions require expertise, creative problem-solving, independent analysis, and handling exceptional cases.";
      }
      default: {
        return "Medium difficulty level requiring solid understanding and application of concepts.";
      }
    }
  }

  private getDifficultyGuidanceForLevel(
    difficultyLevel: DifficultyLevel,
  ): string {
    switch (difficultyLevel) {
      case DifficultyLevel.BASIC: {
        return `
        DIFFICULTY GUIDELINES:
        - Focus on recall and recognition of fundamental concepts
        - Use terms like "identify," "define," "list," "describe"
        - Test simple factual knowledge with straightforward answers
        - Questions should verify basic comprehension, not application
        `;
      }
      case DifficultyLevel.EASY: {
        return `
        DIFFICULTY GUIDELINES:
        - Test basic understanding and simple application
        - Use terms like "explain," "summarize," "classify," "compare"
        - Questions should require connecting related concepts
        - Allow for some basic problem-solving with clear parameters
        `;
      }
      case DifficultyLevel.MEDIUM: {
        return `
        DIFFICULTY GUIDELINES:
        - Test application and analysis of concepts
        - Use terms like "apply," "implement," "analyze," "differentiate"
        - Questions should require deeper understanding of relationships
        - Include some complexity that requires careful consideration
        `;
      }
      case DifficultyLevel.CHALLENGING: {
        return `
        DIFFICULTY GUIDELINES:
        - Test evaluation and synthesis of complex concepts
        - Use terms like "evaluate," "assess," "critique," "formulate"
        - Questions should involve comparing different approaches
        - Require integration of multiple concepts to solve problems
        - Include nuance that differentiates partial from complete understanding
        `;
      }
      case DifficultyLevel.ADVANCED: {
        return `
        DIFFICULTY GUIDELINES:
        - Test creation, innovation, and mastery
        - Use terms like "create," "design," "develop," "optimize"
        - Questions should require expert-level understanding
        - Test ability to handle exceptional cases and edge scenarios
        - Require independent critical analysis of complex situations
        `;
      }
      default: {
        return `
        DIFFICULTY GUIDELINES:
        - Match question complexity to the medium difficulty level
        - Balance factual recall with analytical thinking
        - Questions should be neither too basic nor too advanced
        `;
      }
    }
  }

  async generateQuestionRewordings(
    questionText: string,
    variationCount: number,
    questionType: QuestionType,
    assignmentId: number,
    choices?: Choice[],
    variants?: VariantDto[],
  ): Promise<
    {
      id: number;
      variantContent: string;
      choices: Choice[];
    }[]
  > {
    const baseQuestionSchema = z.object({
      id: z.number().describe("Unique identifier for the variation"),
      variantContent: z
        .string()
        .min(10)
        .describe(
          "A reworded variation of the question text that preserves the original meaning and difficulty",
        ),
    });

    const trueFalseQuestionItemSchema = baseQuestionSchema.extend({
      type: z.literal("TRUE_FALSE"),
      choices: z
        .array(
          z.object({
            choice: z.enum(["true", "false", "True", "False"]),
            points: z.number().min(0),
            feedback: z.string().optional(),
            isCorrect: z.boolean(),
          }),
        )
        .length(1),
    });

    const multipleCorrectQuestionItemSchema = baseQuestionSchema.extend({
      choices: z
        .array(
          z.object({
            choice: z.string().min(1),
            points: z
              .number()
              .min(0)
              .describe("Whole Points assigned for this choice"),
            feedback: z.string().min(5).optional(),
            isCorrect: z.boolean(),
          }),
        )
        .min(3),
    });

    const singleCorrectQuestionItemSchema = baseQuestionSchema.extend({
      choices: z
        .array(
          z.object({
            choice: z.string().min(1),
            points: z
              .number()
              .min(0)
              .describe("Whole Points assigned for this choice"),
            feedback: z.string().min(5).optional(),
            isCorrect: z.boolean(),
          }),
        )
        .min(3),
    });

    let parser: StructuredOutputParser<any>;
    switch (questionType) {
      case QuestionType.TRUE_FALSE: {
        parser = StructuredOutputParser.fromZodSchema(
          z.array(trueFalseQuestionItemSchema).min(1).max(variationCount),
        );
        break;
      }
      case QuestionType.MULTIPLE_CORRECT: {
        parser = StructuredOutputParser.fromZodSchema(
          z.array(multipleCorrectQuestionItemSchema).min(1).max(variationCount),
        );
        break;
      }
      case QuestionType.SINGLE_CORRECT: {
        parser = StructuredOutputParser.fromZodSchema(
          z.array(singleCorrectQuestionItemSchema).min(1).max(variationCount),
        );
        break;
      }
      default: {
        parser = StructuredOutputParser.fromZodSchema(
          z.array(baseQuestionSchema).min(1).max(variationCount),
        );
      }
    }

    const formatInstructions = parser.getFormatInstructions();

    const template = `
You are an expert assessment designer tasked with creating variations of a question while preserving its difficulty and core testing concept.

ORIGINAL QUESTION:
{questionText}
ORIGINAL CHOICES: {originalChoices}
EXISTING VARIANTS:
{existingVariants}
NUMBER OF VARIATIONS REQUESTED: {variationCount}

QUALITY REQUIREMENTS:
1. Create exactly {variationCount} high-quality variations
2. Each variation must:
   - Preserve the exact same difficulty level as the original
   - Test the same knowledge/skill as the original
   - Be clearly distinct from the original and other variations
   - Use precise language with no ambiguity
   - Have proper grammar and spelling

3. For choice-based questions:
   - Maintain the same pattern of correct/incorrect answers
   - Reword ALL answer choices for each variation
   - Ensure distractors remain equally plausible
   - Provide educational feedback for each choice
   - Keep original point distribution
   - IMPORTANT: Points must be non-negative integers (>= 0) for all questions

4. Avoid simply:
   - Changing minor words or punctuation
   - Rearranging sentence structure only
   - Creating awkward or unnatural phrasing

FORMAT INSTRUCTIONS:
{formatInstructions}
`;

    const prompt = new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        formatInstructions: formatInstructions,
        variationCount: variationCount.toString(),
        existingVariants: variants
          ? JSON.stringify(variants, null, 2)
          : "No existing variants provided",
        questionText: questionText,
        originalChoices: choices
          ? JSON.stringify(choices, null, 2)
          : "No choices provided",
      },
    });

    let response: string | undefined;
    let attemptsLeft = this.MAX_GENERATION_RETRIES;
    let success = false;

    while (attemptsLeft > 0 && !success) {
      try {
        response = await this.promptProcessor.processPrompt(
          prompt,
          assignmentId,
          AIUsageType.ASSIGNMENT_GENERATION,
        );

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const parsedResponse = await parser.parse(response);
        if (Array.isArray(parsedResponse) && parsedResponse.length > 0) {
          success = true;
        } else {
          throw new Error("Response did not contain valid question variations");
        }
      } catch (error) {
        this.logger.warn(
          `Error generating question variations (attempt ${
            this.MAX_GENERATION_RETRIES - attemptsLeft + 1
          }): ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        attemptsLeft--;
      }
    }

    if (!success || !response) {
      this.logger.error(
        "Failed to generate question variations after all attempts",
      );
      throw new HttpException(
        "Failed to generate question variations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      interface QuestionRewording {
        id: number;
        variantContent: string;
        choices?: Choice[];
      }

      const parsedResponse = (await parser.parse(
        response,
      )) as QuestionRewording[];
      const responseArray = Array.isArray(parsedResponse)
        ? parsedResponse
        : [parsedResponse];

      return responseArray.map((item, index) => {
        const variant = {
          id: item.id ?? index + 1,
          variantContent: item.variantContent ?? "",
          choices: [] as Choice[],
        };

        if (item.choices && Array.isArray(item.choices)) {
          variant.choices = item.choices.map(
            (rewordedChoice: Choice, choiceIndex: number) => {
              const originalChoice =
                choices && choiceIndex < choices.length
                  ? choices[choiceIndex]
                  : null;
              return {
                choice: rewordedChoice.choice,
                points:
                  rewordedChoice.points ??
                  originalChoice?.points ??
                  (rewordedChoice.isCorrect ? 1 : 0),
                feedback:
                  rewordedChoice.feedback ||
                  originalChoice?.feedback ||
                  (rewordedChoice.isCorrect
                    ? "This is the correct answer."
                    : "This is not the correct answer."),
                isCorrect: rewordedChoice.isCorrect === true,
                id: originalChoice?.id ?? choiceIndex + 1,
              };
            },
          );
        } else if (choices) {
          variant.choices = choices.map((choice, choiceIndex) => ({
            ...choice,
            id: choiceIndex + 1,
          }));
        }

        return variant;
      });
    } catch (error) {
      this.logger.error(
        `Error parsing question rewordings: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw new HttpException(
        "Failed to parse question rewordings",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async generateQuestionGradingContext(
    questions: { id: number; questionText: string }[],
    assignmentId: number,
  ): Promise<Record<number, number[]>> {
    if (!questions || questions.length === 0) {
      return {};
    }

    const parser = StructuredOutputParser.fromZodSchema(
      z.array(
        z
          .object({
            questionId: z.number().describe("The id of the question"),
            contextQuestions: z
              .array(z.number())
              .describe(
                "The ids of all the questions that this question depends upon contextually",
              ),
          })
          .describe(
            "Array of objects, where each object represents a question and its contextual dependencies.",
          ),
      ),
    );

    const formatInstructions = parser.getFormatInstructions();

    const template = `
    You are an expert assessment designer tasked with identifying contextual relationships between questions in an assignment.
    
    A contextual relationship means that understanding or answering one question correctly may depend on knowledge
    from another question or its expected answer. This helps create a dependency graph for grading.
    
    QUESTIONS:
    {questions}
    
    INSTRUCTIONS:
    
    1. Carefully analyze each question to identify if it builds upon or requires knowledge from other questions.
    
    2. For each question, provide an array of IDs of questions it depends on contextually.
       - For example, if Question 5 requires knowledge tested in Questions 2 and 3, then Question 5 has context
         dependencies on Questions 2 and 3.
       - If a question is independent and doesn't rely on other questions, return an empty array.
       - Only include DIRECT dependencies (if A depends on B and B depends on C, A's dependencies should include
         B but not necessarily C).
    
    3. Be careful to avoid creating circular dependencies (A depends on B depends on A).
    
    4. Return a complete array with an entry for EVERY question, even those with no dependencies.
    
    {formatInstructions}
    `;

    let response: string | undefined;
    let attemptsLeft = this.MAX_GENERATION_RETRIES;
    let success = false;

    while (attemptsLeft > 0 && !success) {
      try {
        response = await this.promptProcessor.processPrompt(
          new PromptTemplate({
            template,
            inputVariables: [],
            partialVariables: {
              questions: JSON.stringify(questions, null, 2),
              formatInstructions: formatInstructions,
            },
          }),
          assignmentId,
          AIUsageType.ASSIGNMENT_GENERATION,
        );

        const parsedResponse = await parser.parse(response);

        if (!Array.isArray(parsedResponse)) {
          throw new TypeError("Response is not an array");
        }

        if (parsedResponse.length !== questions.length) {
          throw new Error(
            `Expected ${questions.length} items in response, got ${parsedResponse.length}`,
          );
        }

        const dependencies: Record<number, Set<number>> = {};
        for (const item of parsedResponse) {
          dependencies[item.questionId] = new Set(item.contextQuestions);
        }

        if (this.hasCircularDependencies(dependencies)) {
          throw new Error("Circular dependencies detected in response");
        }

        success = true;
      } catch (error) {
        this.logger.warn(
          `Error generating question dependencies (attempt ${
            this.MAX_GENERATION_RETRIES - attemptsLeft + 1
          }): ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        attemptsLeft--;
      }
    }

    if (!success || !response) {
      this.logger.error(
        "Failed to generate question dependencies after all attempts",
      );
      return this.generateFallbackDependencies(questions);
    }

    try {
      const parsedResponse = await parser.parse(response);

      const gradingContextQuestionMap: Record<number, number[]> = {};
      for (const item of parsedResponse) {
        gradingContextQuestionMap[item.questionId] = item.contextQuestions;
      }

      return gradingContextQuestionMap;
    } catch (error) {
      this.logger.error(
        `Error parsing question context: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return this.generateFallbackDependencies(questions);
    }
  }

  private hasCircularDependencies(
    dependencies: Record<number, Set<number>>,
  ): boolean {
    const checkCycle = (
      nodeId: number,
      visited: Set<number>,
      path: Set<number>,
    ): boolean => {
      if (path.has(nodeId)) {
        return true;
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      path.add(nodeId);

      const nodeDeps = dependencies[nodeId] || new Set();
      for (const depId of nodeDeps) {
        if (checkCycle(depId, visited, path)) {
          return true;
        }
      }

      path.delete(nodeId);
      return false;
    };

    const visited = new Set<number>();
    for (const nodeId of Object.keys(dependencies).map(Number)) {
      if (checkCycle(nodeId, visited, new Set())) {
        return true;
      }
    }

    return false;
  }

  private generateFallbackDependencies(
    questions: { id: number; questionText: string }[],
  ): Record<number, number[]> {
    const dependencies: Record<number, number[]> = {};

    for (let index = 0; index < questions.length; index++) {
      const questionId = questions[index].id;
      dependencies[questionId] = [];

      const questionText = questions[index].questionText.toLowerCase();

      for (let index_ = 0; index_ < index; index_++) {
        const earlierQuestionId = questions[index_].id;

        if (
          questionText.includes(`question ${index_ + 1}`) ||
          (index === index_ + 1 && questionText.includes("previous question"))
        ) {
          dependencies[questionId].push(earlierQuestionId);
        }
      }
    }

    return dependencies;
  }
}
