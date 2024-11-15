import { get_encoding, type Tiktoken } from "@dqbd/tiktoken";
import type { BaseLanguageModel as BaseLLM } from "@langchain/core/language_models/base";
import { PromptTemplate } from "@langchain/core/prompts";
import { OpenAI } from "@langchain/openai";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  AIUsage,
  AIUsageType,
  Question,
  QuestionType,
  QuestionVariant,
} from "@prisma/client";
import { sanitize } from "isomorphic-dompurify";
import { OpenAIModerationChain } from "langchain/chains";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import type { Logger } from "winston";
import { z } from "zod";
import { PrismaService } from "../../prisma.service";
import { QuestionsToGenerate } from "../assignment/dto/post.assignment.request.dto";
import { AssignmentTypeEnum } from "../assignment/dto/update.assignment.request.dto";
import {
  Choice,
  QuestionDto,
  VariantDto,
  VariantType,
} from "../assignment/dto/update.questions.request.dto";
import type { FileUploadQuestionEvaluateModel } from "./model/file.based.question.evaluate.model";
import { FileBasedQuestionResponseModel } from "./model/file.based.question.response.model";
import type { TextBasedQuestionEvaluateModel } from "./model/text.based.question.evaluate.model";
import type { TextBasedQuestionResponseModel } from "./model/text.based.question.response.model";
import type { UrlBasedQuestionEvaluateModel } from "./model/url.based.question.evaluate.model";
import type { UrlBasedQuestionResponseModel } from "./model/url.based.question.response.model";
import {
  generateAssignmentQuestionsFromFileAndObjectivesTemplate,
  generateAssignmentQuestionsFromFileTemplate,
  generateAssignmentQuestionsFromObjectivesTemplate,
  generateCodeFileUploadMarkingRubricTemplate,
  generateDocumentFileUploadMarkingRubricTemplate,
  generateImageFileUploadMarkingRubricTemplate,
  generateMultipleBasedMarkingRubricTemplate,
  generateQuestionRewordingsTemplate,
  generateQuestionsGradingContext,
  generateQuestionWithChoicesRewordingsTemplate,
  generateSingleBasedMarkingRubricTemplate,
  generateTextBasedMarkingRubricTemplate,
  generateUrlBasedMarkingRubricTemplate,
  gradeCodeFileQuestionLlmTemplate,
  gradeDocumentFileQuestionLlmTemplate,
  gradeImageFileQuestionLlmTemplate,
  gradeTextBasedQuestionLlmTemplate,
  gradeUrlBasedQuestionLlmTemplate,
} from "./templates";

@Injectable()
export class LlmService {
  private readonly logger: Logger;
  private llm: BaseLLM;
  private tiktokenEncoding: Tiktoken;
  static readonly llmModelName: string = "gpt-4o-2024-08-06";

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    private readonly prisma: PrismaService,
  ) {
    this.logger = parentLogger.child({ context: LlmService.name });
    this.llm = new OpenAI({
      temperature: 0.5,
      modelName: LlmService.llmModelName,
    });
    this.tiktokenEncoding = get_encoding("gpt2");
  }

  async applyGuardRails(message: string): Promise<boolean> {
    const moderation = new OpenAIModerationChain();

    const { output: guardRailsResponse } = await moderation.invoke({
      input: message,
    });

    return (
      guardRailsResponse !==
      "Text was found that violates OpenAI's content policy."
    );
  }

  /**
   * Sanitize the content by removing any potentially harmful or unnecessary elements.
   * This method uses DOMPurify to remove scripts or other dangerous HTML content.
   * @param content The content to be sanitized.
   * @returns The sanitized content.
   */
  sanitizeContent(content: string): string {
    this.logger.info("Sanitizing content...");
    const sanitizedContent = sanitize(content);
    this.logger.info("Content sanitized.");
    return sanitizedContent;
  }

  /**
   * Moderate the content using OpenAI's moderation API to detect harmful or inappropriate content.
   * @param content The content to be moderated.
   * @returns An object containing moderation status.
   */
  async moderateContent(
    content: string,
  ): Promise<{ flagged: boolean; details: string }> {
    try {
      this.logger.info("Moderating content...");
      const moderationChain = new OpenAIModerationChain();
      const moderationResult = await moderationChain.invoke({ input: content });

      const flagged = moderationResult.output !== "No issues found.";
      const details: string = moderationResult.output as string;

      if (flagged) {
        this.logger.warn(`Content flagged: ${details}`);
      } else {
        this.logger.info("Content passed moderation.");
      }

      return { flagged, details };
    } catch (error) {
      this.logger.error(
        `Content moderation failed: ${(error as Error).message}`,
      );
      throw new HttpException(
        "Content moderation failed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async generateQuestionGradingContext(
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

    const prompt = new PromptTemplate({
      template: generateQuestionsGradingContext,
      inputVariables: [],
      partialVariables: {
        questions_json_array: JSON.stringify(questions),
        format_instructions: formatInstructions,
      },
    });

    const response = await this.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GENERATION,
    );
    const parsedResponse = await parser.parse(response);
    const gradingContextQuestionMap: Record<number, number[]> = {};
    for (const item of parsedResponse) {
      gradingContextQuestionMap[item.questionId] = item.contextQuestions;
    }
    return gradingContextQuestionMap;
  }

  async gradeFileBasedQuestion(
    fileBasedQuestionEvaluateModel: FileUploadQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<FileBasedQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      questionType,
    } = fileBasedQuestionEvaluateModel;

    const validateLearnerResponse = await this.applyGuardRails(
      learnerResponse.map((item) => item.content).join(" "),
    );
    const templates = {
      CODE: gradeCodeFileQuestionLlmTemplate,
      IMAGE: gradeImageFileQuestionLlmTemplate,
      UPLOAD: gradeDocumentFileQuestionLlmTemplate,
    };
    const selectedTemplate = templates[questionType as keyof typeof templates];

    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    const prompt = new PromptTemplate({
      template: selectedTemplate,
      inputVariables: [],
      partialVariables: {
        question: question,
        files: JSON.stringify(
          learnerResponse.map((item) => {
            return {
              filename: item.filename,
              content: item.content,
            };
          }),
        ),
        total_points: totalPoints.toString(),
        scoring_type: scoringCriteriaType,
        scoring_criteria: JSON.stringify(scoringCriteria),
      },
    });

    // Define the format for the output as separate values instead of JSON
    const response = await this.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
    );

    // Assuming response is a single string containing points and feedback separately, e.g.:
    // "Points: 3\nFeedback: The response demonstrates a basic understanding but requires improvement."

    const pointsMatch = response.match(/Points:\s*(\d+)/);
    const feedbackMatch = response.match(/Feedback:\s*([\S\s]+)/);

    if (!pointsMatch || !feedbackMatch) {
      throw new HttpException(
        "Invalid response format from LLM",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Parse points and feedback
    const points = Number.parseInt(pointsMatch[1], 10);
    const feedback = feedbackMatch[1].trim();

    // Construct the response model
    const fileBasedQuestionResponseModel: FileBasedQuestionResponseModel = {
      points,
      feedback,
    };

    return fileBasedQuestionResponseModel;
  }

  async gradeTextBasedQuestion(
    textBasedQuestionEvaluateModel: TextBasedQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<TextBasedQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
    } = textBasedQuestionEvaluateModel;

    // Since question and scoring criteria are also validated with guard rails, only validate learnerResponse
    const validateLearnerResponse = await this.applyGuardRails(learnerResponse);
    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    const parser = StructuredOutputParser.fromZodSchema(
      z
        .object({
          points: z.number().describe("Points awarded based on the criteria"),
          feedback: z
            .string()
            .describe(
              "Feedback for the learner based on their response to the criteria",
            ),
        })
        .describe("Object representing points and feedback"),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: gradeTextBasedQuestionLlmTemplate,
      inputVariables: [],
      partialVariables: {
        question: question,
        assignment_instructions: assignmentInstrctions,
        previous_questions_and_answers: JSON.stringify(
          previousQuestionsAnswersContext,
        ),
        learner_response: learnerResponse,
        total_points: totalPoints.toString(),
        scoring_type: scoringCriteriaType,
        scoring_criteria: JSON.stringify(scoringCriteria),
        format_instructions: formatInstructions,
      },
    });
    console.log("assignmentId", assignmentId);

    const response = await this.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
    );

    const textBasedQuestionResponseModel = (await parser.parse(
      response,
    )) as TextBasedQuestionResponseModel;

    return textBasedQuestionResponseModel;
  }

  async gradeUrlBasedQuestion(
    urlBasedQuestionEvaluateModel: UrlBasedQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<UrlBasedQuestionResponseModel> {
    const {
      question,
      urlProvided,
      isUrlFunctional,
      urlBody,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
    } = urlBasedQuestionEvaluateModel;

    // Since question and scoring criteria are also validated with guard rails, only validate learnerResponse
    const validateLearnerResponse = await this.applyGuardRails(urlProvided);
    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    const parser = StructuredOutputParser.fromZodSchema(
      z
        .object({
          points: z.number().describe("Points awarded based on the criteria"),
          feedback: z
            .string()
            .describe(
              "Feedback for the learner based on their response to the criteria",
            ),
        })
        .describe("Object representing points and feedback"),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: gradeUrlBasedQuestionLlmTemplate,
      inputVariables: [],
      partialVariables: {
        question: question,
        assignment_instructions: assignmentInstrctions,
        previous_questions_and_answers: JSON.stringify(
          previousQuestionsAnswersContext,
        ),
        url_provided: urlProvided,
        url_body: urlBody,
        is_url_functional: isUrlFunctional ? "funtional" : "not functional",
        total_points: totalPoints.toString(),
        scoring_type: scoringCriteriaType,
        scoring_criteria: JSON.stringify(scoringCriteria),
        format_instructions: formatInstructions,
      },
    });

    const response = await this.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
    );

    const urlBasedQuestionResponseModel = (await parser.parse(
      response,
    )) as UrlBasedQuestionResponseModel;

    return urlBasedQuestionResponseModel;
  }
  async generateQuestionRewordings(
    questionText: string,
    variationCount: number,
    questionType: QuestionType,
    assignmentId: number,
    choices?: {
      choice: string;
      points: number;
      feedback: string;
      isCorrect: boolean;
    }[],
    variants?: VariantDto[],
  ): Promise<
    {
      id: number;
      variantContent: string;
      choices: {
        choice: string;
        points: number;
        feedback: string;
        isCorrect: boolean;
      }[];
    }[]
  > {
    const choiceTexts = choices?.map((choice) => choice.choice) || [];
    const parser = StructuredOutputParser.fromZodSchema(
      z.array(
        z.object({
          id: z.number().describe("Unique identifier for the variation"),
          variantContent: z
            .string()
            .describe("A reworded variation of the question text"),
          choices: z
            .array(z.string())
            .optional()
            .describe("Array of reworded choices"),
        }),
      ),
    );

    const formatInstructions = parser.getFormatInstructions();

    const promptTemplate =
      questionType === QuestionType.MULTIPLE_CORRECT ||
      questionType === QuestionType.SINGLE_CORRECT
        ? generateQuestionWithChoicesRewordingsTemplate
        : generateQuestionRewordingsTemplate;
    const prompt = new PromptTemplate({
      template: promptTemplate,
      inputVariables: [],
      partialVariables: {
        question_text: questionText,
        variation_count: variationCount.toString(),
        choices_text: JSON.stringify(choiceTexts),
        format_instructions: formatInstructions,
        variants: JSON.stringify(variants) || "[]",
      },
    });

    const response = await this.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.QUESTION_GENERATION,
    );
    const parsedResponse = await parser.parse(response);
    return parsedResponse.map((item, index) => ({
      id: index,
      variantContent: item.variantContent ?? "",
      choices: (item.choices ?? []).map((rewordedChoice, index_) => ({
        choice: rewordedChoice,
        points: choices?.[index_]?.points ?? 0,
        feedback: choices?.[index_]?.feedback ?? "",
        isCorrect: choices?.[index_]?.isCorrect ?? false,
      })),
    }));
  }
  async createMarkingRubric(
    questions: { id: number; questionText: string; questionType: string }[],
    variantMode: boolean,
    assignmentId: number,
  ): Promise<
    Record<
      number,
      | string
      | {
          choices: Choice[];
          variants?: {
            id: number;
            variantContent: string;
            choices: Choice[];
          }[];
        }
      | { id: number; description: string; points: number }[]
    >
  > {
    const templates = {
      TEXT: generateTextBasedMarkingRubricTemplate,
      URL: generateUrlBasedMarkingRubricTemplate,
      MULTIPLE_CORRECT: generateMultipleBasedMarkingRubricTemplate,
      SINGLE_CORRECT: generateSingleBasedMarkingRubricTemplate,
      UPLOAD: generateDocumentFileUploadMarkingRubricTemplate,
      CODE: generateCodeFileUploadMarkingRubricTemplate,
      IMAGE: generateImageFileUploadMarkingRubricTemplate,
    };

    const markingRubricMap: Record<
      number,
      | string
      | {
          choices: Choice[];
          variants?: {
            id: number;
            variantContent: string;
            choices: Choice[];
          }[];
        }
      | { id: number; description: string; points: number }[]
    > = {};

    for (const question of questions) {
      const selectedTemplate =
        templates[question.questionType as keyof typeof templates];

      const parser = StructuredOutputParser.fromZodSchema(
        z.array(
          z.object({
            questionId: z.number().describe("The id of the question"),
            rubric: z
              .array(
                z.object({
                  id: z
                    .number()
                    .describe("Unique identifier for each criterion"),
                  description: z.string().describe("Criterion description"),
                  points: z
                    .number()
                    .describe("Points awarded for this criterion"),
                }),
              )
              .optional()
              .describe(
                "The marking rubric for text, URL and Upload based questions, structured as an array of criterion objects",
              ),
            choices: z
              .array(
                z.object({
                  choice: z.string().describe("A possible answer choice"),
                  isCorrect: z.boolean().describe("Correct answer or not"),
                  points: z.number().describe("Points assigned"),
                  feedback: z.string().describe("Feedback for learner"),
                }),
              )
              .optional()
              .describe("Array of choices for choice-based questions"),
          }),
        ),
      );

      const formatInstructions = parser.getFormatInstructions();

      const prompt = new PromptTemplate({
        template: selectedTemplate,
        inputVariables: [],
        partialVariables: {
          questions_json_array: JSON.stringify([question]),
          format_instructions: formatInstructions,
        },
      });

      try {
        const response = await this.processPrompt(
          prompt,
          assignmentId,
          AIUsageType.QUESTION_GENERATION,
        );
        const parsedResponse = await parser.parse(response);
        if (
          question.questionType === "TEXT" ||
          question.questionType === "URL" ||
          question.questionType === "UPLOAD" ||
          question.questionType === "CODE" ||
          question.questionType === "IMAGES"
        ) {
          markingRubricMap[question.id] = parsedResponse[0].rubric.map(
            (item: unknown) => ({
              id: (item as { id: number }).id ?? 0,
              description: (item as { description: string }).description ?? "",
              points: (item as { points: number }).points ?? 0,
            }),
          );
        }

        if (
          question.questionType === "MULTIPLE_CORRECT" ||
          question.questionType === "SINGLE_CORRECT"
        ) {
          for (const item of parsedResponse) {
            markingRubricMap[item.questionId] = item.choices
              ? {
                  choices: item.choices.map((choice) => ({
                    choice: choice.choice,
                    isCorrect: choice.isCorrect,
                    points: choice.points,
                    feedback: choice.feedback,
                  })),
                }
              : item.rubric.map((rubricItem) => ({
                  id: rubricItem.id ?? 0,
                  description: rubricItem.description ?? "",
                  points: rubricItem.points ?? 0,
                }));
          }
        }
        if (variantMode) {
          const variants = await this.generateQuestionRewordings(
            question.questionText,
            2, // Number of variants to generate, adjust as needed
            question.questionType as QuestionType,
            assignmentId,
            (markingRubricMap[question.id] as { choices: Choice[] })?.choices,
          );

          markingRubricMap[question.id] = {
            ...(markingRubricMap[question.id] as { choices: Choice[] }),
            variants: variants.map((variant) => ({
              id: variant.id,
              variantContent: variant.variantContent,
              choices: variant.choices,
            })),
          };
        }
      } catch (error) {
        this.logger.error(
          `Error processing prompt: ${(error as Error).message}`,
        );
        throw new HttpException(
          "Failed to create marking rubric",
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
    return markingRubricMap;
  }

  /**
   * Process the file content to generate assignment questions using an LLM (e.g., ChatGPT).
   * @param files Array of file data, each containing filename and content.
   * @returns An array of generated questions in the required format.
   */
  /**
   * Process the merged content to generate assignment questions using an LLM (e.g., ChatGPT).
   * @param content The merged content of all files.
   * @returns An array of generated questions.
   */
  async processMergedContent(
    assignmentId: number,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: QuestionsToGenerate,
    content?: string,
    learningObjectives?: string[],
  ): Promise<
    {
      question: string;
      totalPoints: number;
      type: QuestionType;
      scoring: {
        type: string;
        criteria?: {
          id: number;
          description: string;
          points: number;
        }[];
      };
      choices?: {
        choice: string;
        isCorrect: boolean;
        points: number;
        feedback: string;
      }[];
    }[]
  > {
    const response = await this.processPromptWithQuestionTemplate(
      assignmentId,
      assignmentType,
      questionsToGenerate,
      content,
      learningObjectives,
    );

    // Return the array of generated questions
    return response.questions as {
      question: string;
      totalPoints: number;
      type: QuestionType;
      assignmentId: number;
      scoring: {
        type: string;
        criteria?: {
          id: number;
          description: string;
          points: number;
        }[];
      };
      choices?: {
        choice: string;
        isCorrect: boolean;
        points: number;
        feedback: string;
      }[];
    }[]; // Ensure the response contains a `questions` array
  }

  private async processPromptWithQuestionTemplate(
    assignmentId: number,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: QuestionsToGenerate,
    content?: string,
    learningObjectives?: string[],
  ): Promise<{ questions: any[] }> {
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        questions: z.array(
          z.object({
            question: z.string().describe("The question text"),
            type: z
              .enum([
                "TEXT",
                "MULTIPLE_CORRECT",
                "SINGLE_CORRECT",
                "TRUE_FALSE",
              ])
              .describe("The question type"),
            scoring: z
              .object({
                type: z.enum(["CRITERIA_BASED", "AI_GRADED"]).optional(),
                criteria: z
                  .array(
                    z.object({
                      points: z
                        .number()
                        .int()
                        .describe("Points for the criterion"),
                      description: z
                        .string()
                        .describe("Description for this criterion"),
                    }),
                  )
                  .optional(),
              })
              .nullable()
              .optional()
              .describe("Scoring criteria for text-based questions"),
            choices: z
              .array(
                z.object({
                  choice: z.string().describe("Answer choice text"),
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
              .describe(
                "Answer choices for MULTIPLE_CHOICE/SINGLE_CHOICE or TRUE_FALSE questions",
              ),
          }),
        ),
      }),
    );
    let pickGenerateAssignmentQuestionsTemplate: string;
    if (content && learningObjectives) {
      pickGenerateAssignmentQuestionsTemplate =
        generateAssignmentQuestionsFromFileAndObjectivesTemplate;
    } else if (content) {
      pickGenerateAssignmentQuestionsTemplate =
        generateAssignmentQuestionsFromFileTemplate;
    } else if (learningObjectives) {
      pickGenerateAssignmentQuestionsTemplate =
        generateAssignmentQuestionsFromObjectivesTemplate;
    } else {
      throw new HttpException(
        "Provide either content, learning objectives, or both",
        HttpStatus.BAD_REQUEST,
      );
    }
    const formatInstructions = parser.getFormatInstructions();
    const promptTemplate = new PromptTemplate({
      template: pickGenerateAssignmentQuestionsTemplate,
      inputVariables: [],
      partialVariables: {
        format_instructions: formatInstructions,
        content: content ?? "",
        learning_objectives: JSON.stringify(learningObjectives ?? []),
        questionsToGenerate: JSON.stringify(questionsToGenerate),
        assignment_type: assignmentType,
      },
    });
    const response = await this.processPrompt(
      promptTemplate,
      assignmentId,
      AIUsageType.ASSIGNMENT_GENERATION,
    );
    const parsedResponse = await parser.parse(response);

    return { questions: parsedResponse.questions ?? [] };
  }

  // private methods
  private async processPrompt(
    prompt: PromptTemplate,
    assignmentId: number, // Add assignmentId for tracking
    usageType: AIUsageType, // Add usageType for AI usage tracking
  ): Promise<string> {
    const input = await prompt.format({});

    // Get tokens for the input and compute token count
    const inputTokens = this.tiktokenEncoding.encode(input).length;
    this.logger.info(`Input token count: ${inputTokens}`);

    const response: string = (await this.llm.invoke(input)) as string;

    // Get tokens for the response and compute token count
    const responseTokens = this.tiktokenEncoding.encode(response).length;
    this.logger.info(`Output token count: ${responseTokens}`);

    // Track AI usage in the database
    await this.trackAIUsage(
      assignmentId,
      usageType,
      inputTokens,
      responseTokens,
    );

    return response;
  }

  private async trackAIUsage(
    assignmentId: number,
    usageType: AIUsageType,
    tokensIn: number,
    tokensOut: number,
  ): Promise<void> {
    // Ensure that the assignment exists
    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignmentExists) {
      throw new HttpException(
        `Assignment with ID ${assignmentId} does not exist`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Proceed with the upsert if assignment exists
    await this.prisma.aIUsage.upsert({
      where: {
        assignmentId_usageType: {
          assignmentId,
          usageType,
        },
      },
      update: {
        tokensIn: { increment: tokensIn },
        tokensOut: { increment: tokensOut },
        usageCount: { increment: 1 },
        updatedAt: new Date(),
      },
      create: {
        assignmentId,
        usageType,
        tokensIn,
        tokensOut,
        usageCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}
