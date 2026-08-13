/* eslint-disable unicorn/no-null */
import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType, QuestionType, ResponseType } from "@prisma/client";
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { IPromptProcessor } from "src/api/llm/core/interfaces/prompt-processor.interface";
import { Logger } from "winston";
import { z } from "zod";
import {
  EnhancedQuestionsToGenerate,
  MultipleChoiceSubtypes,
} from "../../../../assignment/dto/post.assignment.request.dto";
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

export enum MCSubtype {
  SHORT = "short",
  QUANTITATIVE = "quantitative",
  LONG = "long",
  SCENARIO = "scenario",
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
  mcSubtype?: MCSubtype;
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
  mcSubtype?: MCSubtype;
}

@Injectable()
export class QuestionGenerationService implements IQuestionGenerationService {
  private readonly logger: Logger;
  private readonly MAX_GENERATION_RETRIES = 3;
  private readonly BATCH_SIZE = 5;
  private readonly BATCH_CONCURRENCY = 2;
  // Monotonic counter — guarantees globally-unique question IDs within a
  // service instance. Math.random()-based IDs could collide across concurrent
  // batch calls, corrupting the initialSubtypeById / shortfallOwnerById maps.
  private nextQuestionId = 0;

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
    const subtypeCounts = questionsToGenerate.multipleChoiceSubtypes;

    const subtypeTotal = subtypeCounts
      ? (subtypeCounts.short || 0) +
        (subtypeCounts.quantitative || 0) +
        (subtypeCounts.long || 0) +
        (subtypeCounts.scenario || 0)
      : 0;

    const hasAnyQuestions =
      Object.values(questionCounts).some((c) => c > 0) || subtypeTotal > 0;

    if (!hasAnyQuestions) {
      return [];
    }

    // Regular batches for non-subtype types (and plain multipleChoice)
    const regularBatches = this.createQuestionBatches(questionCounts);

    // Subtype-tagged batches for each MC subtype
    let subtypeBatches: {
      types: QuestionType[];
      counts: number[];
      mcSubtype: MCSubtype;
    }[] = [];
    if (subtypeCounts) {
      subtypeBatches = this.createSubtypeBatches(subtypeCounts);
    }

    const allBatchSpecs: Array<{
      types: QuestionType[];
      counts: number[];
      mcSubtype?: MCSubtype;
    }> = [
      ...regularBatches.map((b) => ({
        ...b,
        mcSubtype: undefined as MCSubtype | undefined,
      })),
      ...subtypeBatches,
    ];

    const allQuestions: IGeneratedQuestion[] = [];
    const batchPromises: Promise<QuestionGenerationResult>[] = [];

    for (const batch of allBatchSpecs) {
      const batchPromise = this.generateQuestionBatch({
        assignmentId: assignmentId,
        types: batch.types,
        counts: batch.counts,
        difficultyLevel,
        content,
        learningObjectives,
        mcSubtype: batch.mcSubtype,
      });
      batchPromises.push(batchPromise);

      if (batchPromises.length >= this.BATCH_CONCURRENCY) {
        const results = await Promise.all(batchPromises);
        for (const result of results) {
          allQuestions.push(...result.questions);
        }
        batchPromises.length = 0;
      }
    }

    if (batchPromises.length > 0) {
      const results = await Promise.all(batchPromises);
      for (const result of results) {
        allQuestions.push(...result.questions);
      }
    }

    // Snapshot each question's original subtype before the review pass can
    // reclassify them. Used in finalizeSubtypeQuestions to exclude reclassified
    // questions from both the original and the new bucket. Only needed when
    // subtype quotas are in play — finalizeSubtypeQuestions runs only then.
    const initialSubtypeById = new Map<number, MCSubtype>();
    if (subtypeTotal > 0) {
      for (const q of allQuestions) {
        if (q.mcSubtype !== undefined && typeof q.id === "number") {
          initialSubtypeById.set(q.id, q.mcSubtype);
        }
      }
    }

    // Semantic review pass — only runs when subtype questions are present
    let reviewedQuestions = allQuestions;
    if (subtypeTotal > 0) {
      reviewedQuestions = await this.reviewSubtypeQuestions(
        allQuestions,
        assignmentId,
        content,
        learningObjectives,
      );
    }

    // Enforce per-subtype quotas independently, then finalize non-subtype types
    const subtypeResults =
      subtypeCounts && subtypeTotal > 0
        ? await this.finalizeSubtypeQuestions(
            reviewedQuestions,
            subtypeCounts,
            difficultyLevel,
            assignmentId,
            content,
            learningObjectives,
            initialSubtypeById,
          )
        : [];

    const nonSubtypeQuestions = reviewedQuestions.filter(
      (q) => q.mcSubtype === undefined,
    );

    const nonSubtypeResults = this.finalizeQuestionSet(
      nonSubtypeQuestions,
      questionCounts,
      assignmentId,
      difficultyLevel,
      content,
      learningObjectives,
    );

    return [...nonSubtypeResults, ...subtypeResults];
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

  private createSubtypeBatches(
    subtypes: MultipleChoiceSubtypes,
  ): { types: QuestionType[]; counts: number[]; mcSubtype: MCSubtype }[] {
    const batches: {
      types: QuestionType[];
      counts: number[];
      mcSubtype: MCSubtype;
    }[] = [];

    const subtypeEntries: [MCSubtype, number][] = [
      [MCSubtype.SHORT, subtypes.short || 0],
      [MCSubtype.QUANTITATIVE, subtypes.quantitative || 0],
      [MCSubtype.LONG, subtypes.long || 0],
      [MCSubtype.SCENARIO, subtypes.scenario || 0],
    ];

    for (const [mcSubtype, count] of subtypeEntries) {
      if (count <= 0) continue;

      let remaining = count;
      while (remaining > 0) {
        const batchSize = Math.min(remaining, this.BATCH_SIZE);
        batches.push({
          types: [QuestionType.SINGLE_CORRECT],
          counts: [batchSize],
          mcSubtype,
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
      mcSubtype,
    } = parameters;
    const totalCount = counts.reduce((sum, count) => sum + count, 0);
    let generatedQuestions: IGeneratedQuestion[] = [];
    let success = false;
    const errors: string[] = [];

    for (let attempt = 0; attempt < this.MAX_GENERATION_RETRIES; attempt++) {
      try {
        const parser = this.createOutputParser(types);
        const prompt = this.createBatchPrompt(
          types,
          counts,
          difficultyLevel,
          content,
          learningObjectives,
          parser.getFormatInstructions(),
          mcSubtype,
        );

        this.logger.debug(
          `Generating questions for assignment ID: ${assignmentId}`,
        );
        const response = await this.promptProcessor.processPromptForFeature(
          prompt,
          assignmentId,
          AIUsageType.ASSIGNMENT_GENERATION,
          "question_generation",
          "gpt-4o-mini",
          { maxTokens: 8000 },
        );

        const parsed = (await parser.parse(response)) as {
          questions: IGeneratedQuestion[];
        };
        if (!parsed || !parsed.questions || !Array.isArray(parsed.questions)) {
          throw new Error("Invalid response format");
        }

        const rawQuestions = parsed.questions;
        const processedQuestions = this.processGeneratedQuestions(
          rawQuestions,
          assignmentId,
        );

        if (mcSubtype) {
          for (const q of processedQuestions) {
            q.mcSubtype = mcSubtype;
          }
        }

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

        const validationResult = await this.validatorService.validateQuestions(
          assignmentId,
          processedQuestions,
          batchRequirements as EnhancedQuestionsToGenerate,
          difficultyLevel,
          content,
          learningObjectives,
        );

        if (validationResult.isValid) {
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
          errors.push(
            `Validation failed: ${JSON.stringify(validationResult.issues)}`,
          );

          if (attempt < this.MAX_GENERATION_RETRIES - 1) {
            const validIndices = new Set(
              Object.keys(validationResult.issues).map(Number),
            );
            generatedQuestions = processedQuestions.filter(
              (_, index) => !validIndices.has(index),
            );
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
        mcSubtype,
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
              .nonnegative()
              .optional()
              .describe(
                "Maximum word limit for text responses (only include for TEXT question types, omit otherwise)",
              ),
            maxCharacters: z
              .number()
              .int()
              .nonnegative()
              .optional()
              .describe(
                "Maximum character limit for text responses (only include for TEXT question types, omit otherwise)",
              ),
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
    mcSubtype?: MCSubtype,
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

    for (const [index, type] of types.entries()) {
      const count = counts[index];

      switch (type) {
        case QuestionType.SINGLE_CORRECT: {
          if (mcSubtype) {
            questionTypeInstructions.push(
              this.getMCSubtypeInstructions(count, mcSubtype),
            );
          } else {
            questionTypeInstructions.push(`
  Generate ${count} MULTIPLE_CHOICE (SINGLE_CORRECT) questions:
  - Include exactly 4 choices for each question
  - One choice must be clearly correct (1 point)
  - All incorrect choices must have 0 points
  - Distractors should be plausible (not obviously wrong)
  - Each choice must have detailed feedback explaining why it is correct/incorrect
`);
          }
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

  /**
   * Builds per-subtype instructions from the Context Manager prompt standards.
   * Because Mark generates the question and all four choices in one structured-output
   * call (rather than the Context Manager's three-pass pipeline), the question rules,
   * correct-answer rules, and wrong-answer rules are combined into a single block here.
   */
  private getMCSubtypeInstructions(count: number, subtype: MCSubtype): string {
    // ── Verbatim system-level question rules (system-prompt-questions) ──────
    const QUESTION_SYSTEM_RULES = `
  Your questions should reinforce key learning points, not trick the learner. Focus on drawing out the most important concepts and essential information from the provided content.

  Short-type questions should check if the learner paid attention to specific content or reinforce important facts. These questions must ask only one thing — use either a "What" or a "How" format to invoke a short response, but not both in a single question. Do not include examples within the question.

  Scenario-type questions should encourage deeper thinking or simulate real-world interactions a seller might have with a client.

  You MUST follow these question rules:
  1. When using abbreviations or acronyms in a question, always spell them out followed by the acronym in parentheses (e.g., Central Processing Unit (CPU)), except for IBM, which should remain as "IBM" without expansion.
  2. If the question is specifically asking for the meaning or definition of an acronym, DO NOT spell it out within the question itself.
  3. Sentence capitalization.
  4. Clear, simple language and correct punctuation.
  5. Gender specific terms are not allowed, use "they" when needed.
  6. No imprecise modifiers like "best" or "recommended".
  7. Minimize absolute modifiers like "always" or "never".
  8. Avoid local or cultural references.
  9. Avoid slang, jargon, or words with multiple meanings.
  10. Minimize the usage of negative questions; if needed, capitalize the "NOT".
  11. Use "clients" not "customers".
  12. No "true" or "false" questions.
  13. All questions should be fully formed and end in a question mark (?).
  14. Do not ask useless questions: no presenter names, publication dates, website URLs, or who manages a product.
  15. DO NOT include any answers within the question text — the question should just be the question itself.
  16. The answer must be grounded in the content — the information needed to derive the answer must appear in the provided material, but the question may require the learner to interpret, compare, or apply that information. Do NOT ask about information that cannot be inferred from the content at all.
  17. FORBIDDEN question stems — NEVER start a question with: "What percentage", "How many", "How much", "What number of", "How often", "What is the name of", "Can you", "Can clients", or "Can the".
  18. NEVER include URLs, website addresses, API endpoint names, file paths, or version numbers in any question.`;

    // ── Verbatim answer rules (generate-correct-answer + generate-wrong-answers) ──
    const ANSWER_RULES = `
  CORRECT ANSWER RULES:
  - Provide the most accurate response directly based on the content.
  - Keep the correct answer concise — it will be displayed alongside 3 wrong answers of similar length. Do NOT make the correct answer stand out by being longer or more detailed.
  - MAXIMUM 70 words.
  - No one-word answers. Short answers must be a 2-8 word noun phrase — never a single word or bare acronym alone.
  - NEVER include URLs, website addresses, or API endpoint names.
  - Do NOT use vague clichés like "reduces risk", "increases efficiency", "single pane of visibility", or "real-time observability" unless that exact phrase appears verbatim in the content.
  - If the question is a Scenario question recommending a product, state the product and give a one-sentence reason why it fits the client's situation.
  - Use "IBM" instead of "We/You/I" — neutral prose.
  - Never write the words CORRECT or INCORRECT in any answer.

  WRONG ANSWER RULES:
  - Each wrong answer must be factually wrong but sound believable to someone who did not study the material carefully. They should NOT be obvious, joke-tier, or nonsensical.
  - Plausibility: craft wrong answers to seem correct at first glance, based in the content but containing a subtle flaw.
  - Length Balance: each wrong answer must be roughly the same length as the correct answer.
  - Avoid Obvious Errors: errors must be subtle — slight misunderstandings or misinterpretations of the content.
  - Misleading Detail: introduce small but significant details that could mislead someone not deeply familiar with the material.
  - MAXIMUM 70 words per wrong answer.
  - No one-word answers. Short wrong answers must be a 2-8 word noun phrase — never a single word.
  - The wrong answers must NOT be similar to each other — each must be distinct.
  - NEVER include URLs, website addresses, or API endpoint names.
  - Do NOT use vague clichés unless that exact phrase appears verbatim in the content.
  - Never write the words CORRECT or INCORRECT in any answer.`;

    switch (subtype) {
      case MCSubtype.SHORT: {
        return `
  Generate ${count} MULTIPLE_CHOICE (SINGLE_CORRECT) SHORT-subtype questions.

  SHORT QUESTION RULES:
  - These questions should be simple and straightforward and show that the learner was paying attention to the content.
  - Their answers should NOT be quantitative.
  - Only ask useful questions about the product or market — do NOT ask about websites, who to contact, or where to find more information.
  - Use a "What" or "How" format only when the answer is still a concise noun phrase from the content.
  - CRITICAL: A Short question MUST be answerable in a 2-8 word noun phrase WITHOUT explanation. If answering the question requires explaining how or why something works, contributes, or helps — it is NOT a Short question. Questions beginning with "How does X help", "How does X work", "How does X contribute", "How does X impact", or "How does X simplify" require explanation and MUST be typed as Long, not Short.
    WRONG (do not do this): How does Instana's automated discovery help clients? → Type: Short
    CORRECT (do this instead): How does Instana's automated discovery help clients? → Type: Long

  SHORT ANSWER LENGTH: at MOST 5-8 words for both the correct answer and each wrong answer.

  ${QUESTION_SYSTEM_RULES}
  ${ANSWER_RULES}`;
      }

      case MCSubtype.QUANTITATIVE: {
        return `
  Generate ${count} MULTIPLE_CHOICE (SINGLE_CORRECT) QUANTITATIVE-subtype questions.

  QUANTITATIVE QUESTION RULES:
  - The question MUST require the learner to interpret or apply a statistic from the content — not recall it. Frame it as what a number indicates or why it matters.
  - STATE the relevant statistic INSIDE the question stem (give the learner the number), then ask what it demonstrates, implies, or enables. The learner reasons about the number's meaning; they must never have to retrieve the number itself.
  - CRITICAL: The correct answer and every wrong answer must be a short CONCEPTUAL interpretation of the statistic — a business or technical implication. NEVER make a bare number, percentage, figure, or measure an answer choice.
  - Do NOT ask what value a metric has, how much something changed, or what result a specific company achieved — those force a numeric answer and will be rejected. The number is already in the stem; the answer is what that number means.
  - Do NOT start with, or embed mid-sentence, "What percentage", "How many", "How much", "What number", or "How often".
  - GOOD: "Instana cut the bank's mean incident-response time by 45%. What does this improvement indicate?" → answers are short implications (e.g., "Faster operational recovery at scale").
  - BAD (never do this): "What reduction in incident-response time did the bank achieve?" → forces a numeric answer.

  QUANTITATIVE ANSWER LENGTH: at MOST 5-8 words for both the correct answer and each wrong answer.

  ${QUESTION_SYSTEM_RULES}
  ${ANSWER_RULES}`;
      }

      case MCSubtype.LONG: {
        return `
  Generate ${count} MULTIPLE_CHOICE (SINGLE_CORRECT) LONG-subtype questions.

  LONG QUESTION RULES:
  - These questions should have minimum 20-word formatted answers showing insight and detail.
  - Construct long questions in a way that encourages comprehensive, detailed responses.
  - Question stems such as "How does X help", "How does X work", "How does X contribute", "How does X impact", or "How does X simplify" are always Long questions.
  - Mix question styles: some should test understanding of specific capabilities or differences (e.g. "How does IBM Granite differ from general-purpose large language models in enterprise deployment?"); others should require the learner to evaluate or explain a concept.

  LONG ANSWER LENGTH: at LEAST 10 words for both the correct answer and each wrong answer.

  ${QUESTION_SYSTEM_RULES}
  ${ANSWER_RULES}`;
      }

      case MCSubtype.SCENARIO: {
        return `
  Generate ${count} MULTIPLE_CHOICE (SINGLE_CORRECT) SCENARIO-subtype questions.

  SCENARIO QUESTION RULES:
  - These questions should put the learner into a scenario with a client, asking what they should do next if the client does something, or if a client approaches them with some ask.
  - Use formats such as: "A client is looking for...", "If a client needs...", "A client approaches you asking about..."
  - Scenario questions should encourage deeper thinking and simulate real-world interactions a seller might have with a client.
  - Do NOT disguise a definition-lookup question as a scenario — the question must require a genuine recommendation or decision.
  - Mix scenario styles: some put the seller in a client interaction ("A client is looking for…, what would you recommend?"); others test how to handle a specific client ask or objection.

  SCENARIO ANSWER LENGTH: at LEAST 10 words for both the correct answer and each wrong answer. If recommending a product, state the product and give a one-sentence reason why it fits the client's situation.

  ${QUESTION_SYSTEM_RULES}
  ${ANSWER_RULES}`;
      }
    }
  }

  /**
   * Runs the Context Manager question_review_prompt over the subtype-generated
   * questions. Removes semantic duplicates, bad-stem questions, stat-recall
   * questions, and Scenario definition-lookups. Rewrites unclear questions.
   * Corrects Short → Long type mismatches. When a stem or subtype changes,
   * regenerates choices to match the updated question.
   */
  private async reviewSubtypeQuestions(
    questions: IGeneratedQuestion[],
    assignmentId: number,
    content?: string,
    learningObjectives?: string,
  ): Promise<IGeneratedQuestion[]> {
    const subtypeQuestions = questions.filter((q) => q.mcSubtype !== undefined);

    if (subtypeQuestions.length === 0) {
      return questions;
    }

    // Build the review input — "page" carries the index for reconciliation
    const reviewInput = subtypeQuestions.map((q, questionIndex) => ({
      question: q.question,
      type: q.mcSubtype as string,
      page: questionIndex,
    }));

    // Truncate long inputs and defensively escape curly braces so LangChain's
    // PromptTemplate doesn't re-interpret literal `{...}` inside the content
    // as a template placeholder.
    const CONTENT_TRUNCATION_LIMIT = 8000;
    const truncateAndEscape = (raw: string): string => {
      const truncated =
        raw.length > CONTENT_TRUNCATION_LIMIT
          ? raw.slice(0, CONTENT_TRUNCATION_LIMIT) +
            "\n\n[content truncated for review]"
          : raw;
      return truncated.replaceAll("{", "{{").replaceAll("}", "}}");
    };

    const contentSection = content
      ? `CONTENT:\n${truncateAndEscape(content)}\n\n`
      : learningObjectives
        ? `LEARNING OBJECTIVES:\n${truncateAndEscape(learningObjectives)}\n\n`
        : "";

    const template = `
You are an expert quiz content validator responsible for reviewing autogenerated quiz questions based on the provided content.

Your task is to:
1. REMOVE duplicate or nearly identical questions. Two questions are semantic duplicates if they would produce the same correct answer, even if phrased differently. Do not compare only question text — compare the implied correct answer. If two questions share the same answer, remove the weaker or more generic version.
2. REMOVE irrelevant, unsupported, or low-quality questions that do not come directly from the provided content.
3. FIX unclear, poorly written, or ambiguous questions to ensure clarity and correctness.
4. KEEP all existing metadata intact (question text, type, and page number).
5. NEVER change the "type" or "page" field of any question. The type was fixed by the generation request and you have no authority to change it — a retyped question is discarded rather than moved, so relabelling silently destroys it. If a question is wrong for its type, REWRITE the stem to fit the type it already has, or REMOVE it.
6. ENSURE every question strictly follows the quiz-style rules used in question generation.
7. ENSURE every question is fully derived from the provided content.
8. REMOVE any question that starts with "What percentage", "How many", "How much", "What number of", "How often", "What is the name of", "Can you", "Can clients", or "Can the". The first five are trivial stat-lookup questions; the last four are yes/no or naming questions with no learning value. If the underlying concept is valuable, REWRITE the question to ask what the statistic indicates or why it matters.
9. REMOVE any question that contains a URL, website address, API endpoint, or file path.
10. REMOVE any question whose correct answer would obviously be a single word or bare acronym (e.g., "What does X stand for?").
11. REMOVE any Scenario question that is a definition lookup rather than a client-interaction decision.
12. REMOVE any stat-recall question regardless of how it is phrased. A question is stat-recall if: (a) it embeds "what percentage", "what number", or "how much" mid-sentence (e.g., "According to research, what percentage of..."); (b) its trailing clause forces a numeric answer (e.g., "...in terms of incident response time reduction?"); or (c) it asks about a specific company's measurable outcome (e.g., "What reduction did Mizuho Bank achieve?"). These produce trivial number-guessing items where wrong answers are just different percentages. EXEMPTION: a question of type "quantitative" is REQUIRED to state a statistic in its stem and ask what that number indicates, implies, or enables — that is the correct shape, NOT stat-recall. Never remove a "quantitative" question merely for containing a statistic, and never cap how many questions may mention one. Remove a "quantitative" question only if the learner must still supply the number themselves.
13. REWRITE — never retype — any question of type "short" whose stem is "How does X help", "How does X work", "How does X contribute", "How does X impact", or "How does X simplify". These need explanation answers, so they are not valid Short questions. Recast the stem so the same concept is answerable in a 2-8 word noun phrase, keeping the type as "short". Example: {{"question": "How does Instana help teams resolve incidents?", "type": "short"}} MUST become {{"question": "Which Instana capability shortens incident resolution?", "type": "short"}} — the stem changes, the type field does not.

{contentSection}
QUESTIONS TO REVIEW:
{questionsJson}

Output Requirements:
- Return the revised list of questions ONLY in strict JSON format.
- KEEP the exact schema: [{{"question": "...", "type": "...", "page": <number>}}]
- NO additional commentary, no explanations, no Markdown.
- Output JSON ONLY.
`;

    const prompt = new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        contentSection: () => contentSection,
        questionsJson: () => JSON.stringify(reviewInput, null, 2),
      },
    });

    try {
      const response = await this.promptProcessor.processPromptForFeature(
        prompt,
        assignmentId,
        AIUsageType.ASSIGNMENT_GENERATION,
        "question_review",
      );

      // Strip markdown fences if the model wraps the JSON
      const cleaned = response
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      const reviewed = JSON.parse(cleaned) as {
        question: string;
        type: string;
        page: number;
      }[];

      if (!Array.isArray(reviewed)) {
        this.logger.warn(
          "Question review returned non-array — skipping review",
        );
        return questions;
      }

      // Build reconciliation map: index → original IGeneratedQuestion
      const indexMap = new Map<number, IGeneratedQuestion>();
      for (const [questionIndex, q] of subtypeQuestions.entries()) {
        indexMap.set(questionIndex, q);
      }

      const seenPages = new Set<number>();
      const claimedPositions = new Set<number>();
      const reconciled: IGeneratedQuestion[] = [];
      const failedRegenEntries = new Set<IGeneratedQuestion>();
      const choiceRegenPromises: Promise<void>[] = [];
      let droppedCount = 0;

      for (const [reviewOutputIndex, item] of reviewed.entries()) {
        // Empty question text is always a drop — no reconciliation possible
        if (!item.question || item.question.trim().length === 0) {
          this.logger.warn(
            `Review returned empty question at index ${reviewOutputIndex} — skipping item`,
          );
          droppedCount += 1;
          continue;
        }

        // Attempt page-based reconciliation first (in-range integer, not already claimed)
        const pageIsValid =
          typeof item.page === "number" &&
          Number.isInteger(item.page) &&
          item.page >= 0 &&
          item.page < subtypeQuestions.length &&
          !seenPages.has(item.page);

        let matchedPage: number | undefined;
        let original: IGeneratedQuestion | undefined;

        if (pageIsValid) {
          matchedPage = item.page;
          original = indexMap.get(item.page);
        } else {
          // Positional fallback: use subtypeQuestions[reviewOutputIndex] if it
          // exists and hasn't been claimed via page or position by a prior item
          const fallbackCandidate = subtypeQuestions[reviewOutputIndex];
          if (
            fallbackCandidate &&
            !claimedPositions.has(reviewOutputIndex) &&
            !seenPages.has(reviewOutputIndex)
          ) {
            this.logger.warn(
              `Review returned invalid or duplicate page ${item.page} — falling back to positional match at index ${reviewOutputIndex}`,
            );
            matchedPage = reviewOutputIndex;
            original = fallbackCandidate;
          }
        }

        if (matchedPage === undefined || !original) {
          this.logger.warn(
            `Review item at index ${reviewOutputIndex} could not be matched by page or position — skipping item`,
          );
          droppedCount += 1;
          continue;
        }

        // Validate subtype; normalize to lowercase and fall back to original if unknown
        const resolvedSubtype = this.isMCSubtype(item.type)
          ? (item.type.toLowerCase() as MCSubtype)
          : original.mcSubtype;

        seenPages.add(matchedPage);
        claimedPositions.add(reviewOutputIndex);

        const stemChanged =
          item.question.trim() !== (original.question ?? "").trim();
        const subtypeChanged = resolvedSubtype !== original.mcSubtype;

        const reconciliationEntry: IGeneratedQuestion = {
          ...original,
          question: item.question.trim(),
          mcSubtype: resolvedSubtype,
        };

        reconciled.push(reconciliationEntry);

        // Stem or subtype changed — existing choices and feedback are stale
        if (stemChanged || subtypeChanged) {
          const regenPromise = this.refreshChoicesForQuestion(
            reconciliationEntry,
            assignmentId,
          )
            .then((newChoices) => {
              reconciliationEntry.choices = newChoices;
            })
            .catch((error) => {
              // Choices cannot be refreshed — drop the question so
              // finalizeSubtypeQuestions fills the gap with a fresh LLM batch
              failedRegenEntries.add(reconciliationEntry);
              this.logger.warn(
                `Choice regeneration failed for rewritten question — dropping question: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            });
          choiceRegenPromises.push(regenPromise);
        }
      }

      if (droppedCount > 0) {
        this.logger.warn(
          `Review dropped ${droppedCount} of ${subtypeQuestions.length} subtype questions (invalid page/empty question)`,
        );
      }

      await Promise.all(choiceRegenPromises);

      const validReconciled = reconciled.filter(
        (q) => !failedRegenEntries.has(q),
      );

      const nonSubtypeQuestions = questions.filter(
        (q) => q.mcSubtype === undefined,
      );

      return [...nonSubtypeQuestions, ...validReconciled];
    } catch (error) {
      this.logger.warn(
        `Question review failed — proceeding without review: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return questions;
    }
  }

  /**
   * Regenerates the four answer choices for a question whose stem or subtype
   * was changed by the review pass. Keeps the question text and other metadata;
   * only replaces choices and their feedback.
   */
  private async refreshChoicesForQuestion(
    question: IGeneratedQuestion,
    assignmentId: number,
  ): Promise<Choice[]> {
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        choices: z
          .array(
            z.object({
              choice: z.string().min(1).describe("Answer choice text"),
              id: z.number().describe("Unique identifier for the choice"),
              isCorrect: z.boolean().describe("Is this the correct answer?"),
              points: z.number().int().describe("Points for this choice"),
              feedback: z
                .string()
                .optional()
                .describe(
                  "Feedback explaining why this choice is or is not correct",
                ),
            }),
          )
          .length(4)
          .describe("Exactly 4 choices: 1 correct, 3 incorrect"),
      }),
    );

    const template = `
You are regenerating answer choices for a multiple-choice question whose stem was rewritten during review.

QUESTION: {questionText}
SUBTYPE: {subtype}

Generate exactly 4 answer choices:
- 1 correct answer (isCorrect: true, 1 point)
- 3 plausible but incorrect answers (isCorrect: false, 0 points)

{subtypeAnswerRule}

Rules:
- All choices must be similar in length and complexity
- Wrong answers must be plausible but factually incorrect — not obvious or nonsensical
- Wrong answers must be distinct from each other
- Each choice must have feedback explaining why it is or is not correct
- Never write "CORRECT" or "INCORRECT" in feedback text
- NEVER include URLs, website addresses, or version numbers in any choice

{formatInstructions}
`;

    const prompt = new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        questionText: () => question.question,
        subtype: () => {
          if (!question.mcSubtype) {
            throw new Error(
              `refreshChoicesForQuestion called on question without mcSubtype`,
            );
          }
          return question.mcSubtype;
        },
        subtypeAnswerRule: () =>
          this.getSubtypeAnswerLengthRule(question.mcSubtype),
        formatInstructions: () => parser.getFormatInstructions(),
      },
    });

    const response = await this.promptProcessor.processPromptForFeature(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GENERATION,
      "question_generation",
      "gpt-4o-mini",
      { maxTokens: 4000 },
    );

    const parsed = await parser.parse(response);

    // Run through the same normalisation pipeline as every other generated question
    const normalized = this.processChoices({
      ...question,
      choices: parsed.choices as Choice[],
    });

    if (!normalized || normalized.length !== 4) {
      throw new Error(
        `Choice regeneration returned ${normalized?.length ?? 0} choices — expected 4`,
      );
    }

    const correctCount = normalized.filter((c) => c.isCorrect).length;
    if (correctCount !== 1) {
      throw new Error(
        `Choice regeneration returned ${correctCount} correct choices — expected exactly 1`,
      );
    }

    return normalized;
  }

  private getSubtypeAnswerLengthRule(mcSubtype?: MCSubtype): string {
    switch (mcSubtype) {
      case MCSubtype.SHORT: {
        return "Answer length: MAXIMUM 5-8 words per choice — noun phrases only, never full sentences.";
      }
      case MCSubtype.QUANTITATIVE: {
        // Statistic lives in the stem, so numeric choices get rejected by review.
        return "Answer length: MAXIMUM 5-8 words per choice — each choice is a short CONCEPTUAL interpretation of the statistic in the stem. NEVER make a bare number, percentage, figure, or measure a choice.";
      }
      case MCSubtype.LONG: {
        return "Answer length: MINIMUM 10 words per choice — full explanatory sentences.";
      }
      case MCSubtype.SCENARIO: {
        return "Answer length: MINIMUM 10 words per choice — name the recommended product or action and give a one-sentence reason why it fits the scenario.";
      }
      default: {
        return "Answer length: 2-8 words per choice.";
      }
    }
  }

  private processGeneratedQuestions(
    rawQuestions: IGeneratedQuestion[],
    assignmentId: number,
  ): IGeneratedQuestion[] {
    return rawQuestions.map((question) => ({
      id: ++this.nextQuestionId,
      assignmentId,
      question: question.question?.replaceAll("```", "").trim(),
      totalPoints: question.totalPoints || this.getDefaultPoints(question.type),
      type: question.type,
      responseType: question.responseType || this.getDefaultResponseType(),
      difficultyLevel: question.difficultyLevel,
      maxWords:
        (question.maxWords && question.maxWords > 0
          ? question.maxWords
          : null) ||
        this.getDefaultMaxWords(question.type, question.difficultyLevel),
      maxCharacters:
        (question.maxCharacters && question.maxCharacters > 0
          ? question.maxCharacters
          : null) ||
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
            points: 1,
            feedback: "This statement is correct based on the concept.",
          },
        ];
      }

      const originalChoice = question.choices[0];
      const choiceValue =
        typeof originalChoice.choice === "string"
          ? originalChoice.choice
          : String(originalChoice.choice ?? "");
      const choiceText = choiceValue.toLowerCase().trim();
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

    return question.choices.map((choice: Choice, index: number) => {
      const choiceValue =
        typeof choice.choice === "string"
          ? choice.choice
          : String(choice.choice ?? "");
      return {
        choice: choiceValue.replaceAll("```", "").trim() || "",
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
      };
    });
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
        }
      })();

      refinementPromises.push(refinementPromise);
    }

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
    const response = await this.promptProcessor.processPromptForFeature(
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
      "question_generation",
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
    const questionsByType: Record<QuestionType, IGeneratedQuestion[]> =
      {} as Record<QuestionType, IGeneratedQuestion[]>;

    for (const type of Object.values(QuestionType)) {
      questionsByType[type] = [];
    }

    for (const question of questions) {
      if (!questionsByType[question.type]) {
        questionsByType[question.type] = [];
      }
      questionsByType[question.type].push(question);
    }

    const finalQuestions: IGeneratedQuestion[] = [];

    for (const [typeString, requiredCount] of Object.entries(requiredCounts)) {
      const type = typeString as QuestionType;
      if (requiredCount <= 0) continue;

      const availableQuestions = this.sortQuestionsByQuality(
        questionsByType[type],
      );

      const selectedQuestions = availableQuestions.slice(0, requiredCount);

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

    return finalQuestions.map((q, index) => ({
      ...q,
      id: q.id || Date.now() + index,
      assignmentId: assignmentId,
    }));
  }

  /**
   * Enforces per-subtype quotas independently. Groups reviewed questions by
   * mcSubtype, quality-sorts within each group, slices to the required count,
   * and fills any shortfall with a real LLM generation batch using the correct
   * subtype prompt. Only falls back to generic templates if the LLM batch fails.
   */
  private async finalizeSubtypeQuestions(
    questions: IGeneratedQuestion[],
    subtypeCounts: MultipleChoiceSubtypes,
    difficultyLevel: DifficultyLevel,
    assignmentId: number,
    content?: string,
    learningObjectives?: string,
    initialSubtypeById?: Map<number, MCSubtype>,
  ): Promise<IGeneratedQuestion[]> {
    const bySubtype = new Map<MCSubtype, IGeneratedQuestion[]>();
    for (const subtype of Object.values(MCSubtype)) {
      bySubtype.set(subtype, []);
    }

    for (const q of questions) {
      if (q.mcSubtype === undefined) continue;

      const originalSubtype =
        typeof q.id === "number"
          ? (initialSubtypeById?.get(q.id) ?? q.mcSubtype)
          : q.mcSubtype;

      if (q.mcSubtype !== originalSubtype) {
        this.logger.warn(
          `Initial review reclassified a ${originalSubtype} question as ${q.mcSubtype} — not counting it toward either bucket`,
        );
        continue;
      }

      bySubtype.get(q.mcSubtype)?.push(q);
    }

    const entries: [MCSubtype, number][] = [
      [MCSubtype.SHORT, subtypeCounts.short || 0],
      [MCSubtype.QUANTITATIVE, subtypeCounts.quantitative || 0],
      [MCSubtype.LONG, subtypeCounts.long || 0],
      [MCSubtype.SCENARIO, subtypeCounts.scenario || 0],
    ];

    type SubtypeBucket = {
      subtype: MCSubtype;
      required: number;
      fromPool: IGeneratedQuestion[];
      fromShortfall: IGeneratedQuestion[];
      fromFallback: IGeneratedQuestion[];
    };

    // Each subtype's shortfall generation runs independently — parallelize
    const tasks = entries
      .filter(([, required]) => required > 0)
      .map(async ([subtype, required]): Promise<SubtypeBucket> => {
        const pool = this.sortQuestionsByQuality(bySubtype.get(subtype) ?? []);
        const fromPool = pool.slice(0, required);
        const fromShortfall: IGeneratedQuestion[] = [];
        const fromFallback: IGeneratedQuestion[] = [];

        let currentCount = fromPool.length;

        if (currentCount < required) {
          const missing = required - currentCount;

          try {
            // Generate real subtype-specific questions for the shortfall
            const batchResult = await this.generateQuestionBatch({
              assignmentId,
              types: [QuestionType.SINGLE_CORRECT],
              counts: [missing],
              difficultyLevel,
              content,
              learningObjectives,
              mcSubtype: subtype,
            });

            const generated = batchResult.questions.filter(
              (q) => q.type === QuestionType.SINGLE_CORRECT,
            );

            // Tag any untagged questions returned by the batch
            for (const q of generated) {
              q.mcSubtype = subtype;
            }

            fromShortfall.push(...generated.slice(0, missing));
            currentCount += fromShortfall.length;
          } catch (error) {
            this.logger.warn(
              `Subtype batch shortfall generation failed for ${subtype} — using template fallback: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }

          // If the LLM batch still left a gap, fill with tagged templates as last resort
          if (currentCount < required) {
            const stillMissing = required - currentCount;
            const fallbacks = this.generateFallbackQuestionsOfType(
              QuestionType.SINGLE_CORRECT,
              stillMissing,
              difficultyLevel,
              assignmentId,
              content,
              learningObjectives,
              subtype,
            );
            fromFallback.push(...fallbacks);
          }
        }

        return { subtype, required, fromPool, fromShortfall, fromFallback };
      });

    const buckets = await Promise.all(tasks);

    // Re-review all shortfall-generated questions together so they pass through
    // the same semantic filter as the originally generated batch. Template
    // fallbacks stay out — they're last-resort synthetic data. Keep bucket
    // ownership separate from reviewed mcSubtype so a question generated for a
    // missing Short slot cannot inflate the Long bucket after reclassification.
    const allShortfall = buckets.flatMap((b) => b.fromShortfall);

    let reviewedByOriginalSubtype:
      | Map<MCSubtype, IGeneratedQuestion[]>
      | undefined;
    if (allShortfall.length > 0) {
      try {
        const shortfallOwnerById = new Map<number, MCSubtype>();
        for (const bucket of buckets) {
          for (const q of bucket.fromShortfall) {
            if (typeof q.id === "number") {
              shortfallOwnerById.set(q.id, bucket.subtype);
            }
          }
        }

        const reviewedShortfall = await this.reviewSubtypeQuestions(
          allShortfall,
          assignmentId,
          content,
          learningObjectives,
        );

        reviewedByOriginalSubtype = new Map<MCSubtype, IGeneratedQuestion[]>();
        for (const q of reviewedShortfall) {
          const originalSubtype =
            typeof q.id === "number" ? shortfallOwnerById.get(q.id) : undefined;

          if (!originalSubtype) {
            this.logger.warn(
              "Reviewed shortfall question could not be mapped to its requested subtype — skipping it",
            );
            continue;
          }

          if (q.mcSubtype !== originalSubtype) {
            this.logger.warn(
              `Review reclassified a ${originalSubtype} shortfall question as ${
                q.mcSubtype ?? "unknown"
              } — not using it to satisfy the ${originalSubtype} quota`,
            );
            continue;
          }

          const list = reviewedByOriginalSubtype.get(originalSubtype) ?? [];
          list.push(q);
          reviewedByOriginalSubtype.set(originalSubtype, list);
        }
      } catch (error) {
        this.logger.warn(
          `Re-review of shortfall questions failed — using unreviewed shortfall: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        reviewedByOriginalSubtype = undefined;
      }
    }

    const result: IGeneratedQuestion[] = [];
    for (const bucket of buckets) {
      const selected = bucket.fromPool.slice(0, bucket.required);
      const reviewedShortfallForSubtype = reviewedByOriginalSubtype
        ? (reviewedByOriginalSubtype.get(bucket.subtype) ?? [])
        : bucket.fromShortfall;

      let remaining = bucket.required - selected.length;
      if (remaining > 0) {
        selected.push(...reviewedShortfallForSubtype.slice(0, remaining));
      }

      remaining = bucket.required - selected.length;
      if (remaining > 0) {
        selected.push(...bucket.fromFallback.slice(0, remaining));
      }

      remaining = bucket.required - selected.length;
      if (remaining > 0) {
        this.logger.warn(
          `Subtype ${bucket.subtype} quota still missing ${remaining} question(s) after review — using template fallback`,
        );
        selected.push(
          ...this.generateFallbackQuestionsOfType(
            QuestionType.SINGLE_CORRECT,
            remaining,
            difficultyLevel,
            assignmentId,
            content,
            learningObjectives,
            bucket.subtype,
          ),
        );
      }

      result.push(...selected);
    }

    return result;
  }

  private isMCSubtype(value: string): value is MCSubtype {
    const normalized = value?.toLowerCase();
    return (Object.values(MCSubtype) as string[]).includes(normalized);
  }

  private sortQuestionsByQuality(
    questions: IGeneratedQuestion[],
  ): IGeneratedQuestion[] {
    return [...questions].sort((a, b) => {
      const aHasIssues = this.questionHasIssues(a);
      const bHasIssues = this.questionHasIssues(b);

      if (aHasIssues !== bHasIssues) {
        return aHasIssues ? 1 : -1;
      }

      const aIsTemplate = this.isTemplateQuestion(a);
      const bIsTemplate = this.isTemplateQuestion(b);

      if (aIsTemplate !== bIsTemplate) {
        return aIsTemplate ? 1 : -1;
      }

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
      const choiceString =
        typeof choice.choice === "string"
          ? choice.choice
          : String(choice.choice ?? "");
      const choiceValue = choiceString.toLowerCase().trim();
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

      const choiceTexts = question.choices.map((c) => {
        const choiceText =
          typeof c.choice === "string" ? c.choice : String(c.choice ?? "");
        return choiceText.toLowerCase().trim();
      });
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
    mcSubtype?: MCSubtype,
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
            mcSubtype,
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
    mcSubtype?: MCSubtype,
  ): IGeneratedQuestion[] {
    const fallbacks: IGeneratedQuestion[] = [];
    const keyTerms = this.extractKeyTerms(content, learningObjectives);

    for (let index = 0; index < count; index++) {
      const q = this.createEnhancedTemplateQuestion(
        type,
        difficultyLevel,
        keyTerms,
        assignmentId,
      );
      if (mcSubtype) {
        q.mcSubtype = mcSubtype;
      }
      fallbacks.push(q);
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
  ): IGeneratedQuestion {
    const questionId = ++this.nextQuestionId;
    const term = keyTerms.length > 0 ? keyTerms[0] : "the concept";
    const levelText = difficultyLevel.toString().toLowerCase();

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

    switch (type) {
      case QuestionType.SINGLE_CORRECT: {
        return {
          ...baseQuestion,
          randomizedChoices: true,
          choices: this.createContentRelevantChoices(type, term),
        };
      }
      case QuestionType.MULTIPLE_CORRECT: {
        return {
          ...baseQuestion,
          randomizedChoices: true,
          choices: this.createContentRelevantChoices(type, term),
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
    term: string,
  ): Choice[] {
    switch (type) {
      case QuestionType.SINGLE_CORRECT: {
        return [
          {
            id: 1,
            choice: `${term} is a fundamental concept that forms the foundation of this subject area.`,
            isCorrect: true,
            points: 1,
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
            points: 1,
            feedback: `This is correct. ${term} is essential for understanding this subject's core principles.`,
          },
          {
            id: 2,
            choice: `${term} has practical applications in real-world scenarios related to this subject.`,
            isCorrect: true,
            points: 1,
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
            points: 1,
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
            points: 1,
            feedback: `This is correct. It accurately describes one aspect of the concept.`,
          },
          {
            id: 2,
            choice: `This is the second correct answer`,
            isCorrect: true,
            points: 1,
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
            points: 1,
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

  private sanitizeTextValue(value: string | number | null | undefined): string {
    return this.stripHtmlTags(
      typeof value === "string" ? value : String(value ?? ""),
    );
  }

  private normalizeTrueFalseChoice(isCorrect?: boolean): string {
    return isCorrect ? "true" : "false";
  }

  private appendMedia(text: string, mediaHtml: string): string {
    if (!mediaHtml) {
      return text;
    }
    const separator = text ? "\n\n" : "";
    return `${text}${separator}${mediaHtml}`;
  }

  private ensureNonEmpty(
    value: string,
    fallback?: string,
    index?: number,
  ): string {
    if (value) {
      return value;
    }
    if (fallback) {
      return fallback;
    }
    return index === undefined ? "Option" : `Option ${index + 1}`;
  }

  private sanitizeChoiceValue(
    value: string | number | null | undefined,
    fallback?: string,
    index?: number,
  ): string {
    return this.ensureNonEmpty(
      this.sanitizeTextValue(value),
      fallback ? this.sanitizeTextValue(fallback) : "",
      index,
    );
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
    const { cleanedText: strippedQuestionText, mediaHtml: questionMediaHtml } =
      this.stripHtmlPreserveMedia(questionText);
    const sanitizedQuestionText = this.ensureNonEmpty(
      strippedQuestionText,
      "Please answer the question.",
    );
    const sanitizedChoices = choices?.map((choice, index) => ({
      ...choice,
      choice: this.sanitizeChoiceValue(
        choice.choice,
        questionType === QuestionType.TRUE_FALSE
          ? this.normalizeTrueFalseChoice(choice.isCorrect)
          : undefined,
        index,
      ),
      feedback: choice.feedback
        ? this.sanitizeTextValue(choice.feedback)
        : choice.feedback,
    }));
    const sanitizedVariants = variants?.map((variant) => ({
      ...variant,
      variantContent: this.ensureNonEmpty(
        this.stripHtmlPreserveMedia(variant.variantContent).cleanedText,
        sanitizedQuestionText,
      ),
      choices: variant.choices?.map((choice, index) => ({
        ...choice,
        choice: this.sanitizeChoiceValue(
          choice.choice,
          questionType === QuestionType.TRUE_FALSE
            ? this.normalizeTrueFalseChoice(choice.isCorrect)
            : undefined,
          index,
        ),
        feedback: choice.feedback
          ? this.sanitizeTextValue(choice.feedback)
          : choice.feedback,
      })),
    }));

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
            isCorrect: z.boolean().optional(),
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
            isCorrect: z.boolean().optional(),
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
            isCorrect: z.boolean().optional(),
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
   - Use plain text only (no HTML tags, tables, or images)

3. For choice-based questions:
   - Maintain the same pattern of correct/incorrect answers
   - Reword ALL answer choices for each variation
   - Ensure distractors remain equally plausible
   - Provide educational feedback for each choice
   - Keep original point distribution
   - Include "isCorrect" boolean for every choice
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
        existingVariants: sanitizedVariants
          ? JSON.stringify(sanitizedVariants, null, 2)
          : "No existing variants provided",
        questionText: sanitizedQuestionText,
        originalChoices: sanitizedChoices
          ? JSON.stringify(sanitizedChoices, null, 2)
          : "No choices provided",
      },
    });

    let response: string | undefined;
    let attemptsLeft = this.MAX_GENERATION_RETRIES;
    let success = false;

    while (attemptsLeft > 0 && !success) {
      try {
        response = await this.promptProcessor.processPromptForFeature(
          prompt,
          assignmentId,
          AIUsageType.ASSIGNMENT_GENERATION,
          "question_generation",
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
        const baseVariantContent = this.ensureNonEmpty(
          this.stripHtmlTags(item.variantContent ?? ""),
          sanitizedQuestionText,
        );
        const variant = {
          id: item.id ?? index + 1,
          variantContent: this.appendMedia(
            baseVariantContent,
            questionMediaHtml,
          ),
          choices: [] as Choice[],
        };

        if (item.choices && Array.isArray(item.choices)) {
          variant.choices = item.choices.map(
            (rewordedChoice: Choice, choiceIndex: number) => {
              const originalChoice = sanitizedChoices?.[choiceIndex];
              const choiceText =
                typeof rewordedChoice.choice === "string"
                  ? rewordedChoice.choice.toLowerCase().trim()
                  : "";
              const inferredIsCorrect =
                typeof rewordedChoice.isCorrect === "boolean"
                  ? rewordedChoice.isCorrect
                  : questionType === QuestionType.TRUE_FALSE
                    ? choiceText === "true"
                    : (originalChoice?.isCorrect ??
                      (rewordedChoice.points ?? 0) > 0);
              const fallbackFeedback =
                originalChoice?.feedback ||
                (inferredIsCorrect
                  ? "This is the correct answer."
                  : "This is not the correct answer.");
              const fallbackChoice =
                questionType === QuestionType.TRUE_FALSE
                  ? this.normalizeTrueFalseChoice(inferredIsCorrect)
                  : originalChoice?.choice;
              return {
                choice: this.sanitizeChoiceValue(
                  rewordedChoice.choice,
                  fallbackChoice,
                  choiceIndex,
                ),
                points:
                  rewordedChoice.points ??
                  originalChoice?.points ??
                  (inferredIsCorrect ? 1 : 0),
                feedback: this.stripHtmlTags(
                  rewordedChoice.feedback || fallbackFeedback,
                ),
                isCorrect: inferredIsCorrect,
                id: originalChoice?.id ?? choiceIndex + 1,
              };
            },
          );
        } else if (sanitizedChoices) {
          variant.choices = sanitizedChoices.map((choice, choiceIndex) => ({
            ...choice,
            choice: this.sanitizeChoiceValue(
              choice.choice,
              questionType === QuestionType.TRUE_FALSE
                ? this.normalizeTrueFalseChoice(choice.isCorrect)
                : undefined,
              choiceIndex,
            ),
            feedback: choice.feedback
              ? this.stripHtmlTags(choice.feedback)
              : choice.feedback,
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

  private stripHtmlTags(text: string): string {
    if (!text) {
      return "";
    }

    const withoutTags = text.replaceAll(/<[^>]*>/g, "");
    return withoutTags.trim();
  }

  private stripHtmlPreserveMedia(text: string): {
    cleanedText: string;
    mediaHtml: string;
  } {
    if (!text) {
      return { cleanedText: "", mediaHtml: "" };
    }

    const mediaRegex = /<img\b[^>]*>|<table\b[^>]*>[\S\s]*?<\/table>/gi;
    const media: string[] = [];
    let match: RegExpExecArray | null = mediaRegex.exec(text);
    while (match) {
      media.push(match[0]);
      match = mediaRegex.exec(text);
    }

    const withoutMedia = text.replaceAll(mediaRegex, "");
    const cleanedText = withoutMedia.replaceAll(/<[^>]*>/g, "").trim();
    const mediaHtml = media.join("").trim();

    return { cleanedText, mediaHtml };
  }

  async generateQuestionGradingContext(
    questions: { id: number; questionText: string }[],
    assignmentId: number,
  ): Promise<Record<number, number[]>> {
    if (!questions || questions.length === 0) {
      return {};
    }

    const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

    const preparedQuestions = questions.map((q) => {
      const tokens = estimateTokens(q.questionText);
      if (tokens > 150) {
        const sentences = q.questionText.match(/[^!.?]+[!.?]+/g) || [
          q.questionText,
        ];
        const summary = sentences[0].trim();
        return {
          id: q.id,
          questionText:
            summary + (sentences.length > 1 ? " [multi-part question]" : ""),
        };
      }
      return q;
    });

    const totalEstimatedTokens = preparedQuestions.reduce(
      (sum, q) => sum + estimateTokens(q.questionText),
      0,
    );

    const TARGET_TOKENS_PER_BATCH = 80_000;
    const estimatedQuestionsPerBatch = Math.max(
      10,
      Math.floor(
        (TARGET_TOKENS_PER_BATCH * questions.length) / totalEstimatedTokens,
      ),
    );

    if (questions.length > estimatedQuestionsPerBatch) {
      this.logger.info(
        `Processing ${questions.length} questions in batches of ~${estimatedQuestionsPerBatch} ` +
          `(estimated ${totalEstimatedTokens} tokens total)`,
      );
      const dependencies: Record<number, number[]> = {};

      for (
        let index = 0;
        index < preparedQuestions.length;
        index += estimatedQuestionsPerBatch
      ) {
        const batch = preparedQuestions.slice(
          index,
          index + estimatedQuestionsPerBatch,
        );
        try {
          const batchDeps = await this.processQuestionContextBatch(
            batch,
            assignmentId,
          );
          Object.assign(dependencies, batchDeps);
        } catch (error) {
          this.logger.error(
            `Failed to process question context batch ${index / estimatedQuestionsPerBatch + 1}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
          for (const q of batch) {
            dependencies[q.id] = [];
          }
        }
      }

      return dependencies;
    }

    return await this.processQuestionContextBatch(
      preparedQuestions,
      assignmentId,
    );
  }

  private async processQuestionContextBatch(
    questions: { id: number; questionText: string }[],
    assignmentId: number,
  ): Promise<Record<number, number[]>> {
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
        response = await this.promptProcessor.processPromptForFeature(
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
          "question_generation",
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
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        const isTokenLimitError =
          errorMessage.includes("maximum context length") ||
          errorMessage.includes("token");

        if (isTokenLimitError && questions.length > 10) {
          this.logger.warn(
            `Token limit exceeded for ${questions.length} questions. Splitting into smaller batches...`,
          );

          const midpoint = Math.floor(questions.length / 2);
          const firstHalf = questions.slice(0, midpoint);
          const secondHalf = questions.slice(midpoint);

          try {
            const [firstDeps, secondDeps] = await Promise.all([
              this.processQuestionContextBatch(firstHalf, assignmentId),
              this.processQuestionContextBatch(secondHalf, assignmentId),
            ]);

            return { ...firstDeps, ...secondDeps };
          } catch (splitError) {
            this.logger.error(
              `Failed even after splitting batch: ${
                splitError instanceof Error
                  ? splitError.message
                  : "Unknown error"
              }`,
            );
            break;
          }
        }

        this.logger.warn(
          `Error generating question dependencies (attempt ${
            this.MAX_GENERATION_RETRIES - attemptsLeft + 1
          }): ${errorMessage}`,
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
