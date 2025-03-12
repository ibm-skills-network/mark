/* eslint-disable unicorn/no-null */
import { get_encoding, type Tiktoken } from "@dqbd/tiktoken";
import { HumanMessage } from "@langchain/core/messages";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType, QuestionType, ResponseType } from "@prisma/client";
import cld from "cld";
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
  RubricDto,
  ScoringDto,
  VariantDto,
} from "../assignment/dto/update.questions.request.dto";
import {
  Criteria,
  ScoringType,
} from "../assignment/question/dto/create.update.question.request.dto";
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
  generateDocumentFileUploadMarkingRubricTemplate,
  generateMultipleBasedMarkingRubricTemplate,
  generateQuestionRewordingsTemplate,
  generateQuestionsGradingContext,
  generateQuestionWithChoicesRewordingsTemplate,
  generateQuestionWithTrueFalseRewordingsTemplate,
  generateSingleBasedMarkingRubricTemplate,
  generateTextBasedMarkingRubricTemplate,
  generateUrlBasedMarkingRubricTemplate,
  gradeAudioFileQuestionLlmTemplate,
  gradeCodeFileQuestionLlmTemplate,
  gradeDocumentFileQuestionLlmTemplate,
  gradeEssayFileQuestionLlmTemplate,
  gradePresentationFileQuestionLlmTemplate,
  gradeRepoQuestionLlmTemplate,
  gradeSpreadsheetFileQuestionLlmTemplate,
  gradeTextBasedQuestionLlmTemplate,
  gradeUrlBasedQuestionLlmTemplate,
  gradeVideoFileQuestionLlmTemplate,
  translateQuestionTemplate,
} from "./templates";

// this function defines custome templates for each response type
export const responseTypeSpecificInstructions: {
  [key in ResponseType]: string;
} = {
  [ResponseType.CODE]: `
    **Feedback Structure:**
    Provide feedback in the following format:

    1. **Accuracy**: Assess whether the response meets the task requirements and identify any discrepancies.
    2. **Functionality**: Evaluate whether the response works as expected and achieves the intended outcome.
    3. **Efficiency**: Discuss the approach taken and identify any areas for optimization.
    4. **Style**: Examine the clarity, readability, and presentation of the response, noting areas for improvement.
    5. **Practices**: Comment on adherence to best practices, including maintainability, modularity, and clarity.
    6. **Strengths**: Highlight notable features or aspects of the response that demonstrate understanding or innovation.

    **Instructions for Feedback:**
    - Ensure feedback is constructive and actionable.
    - Avoid revealing the correct answer directly.
    - Provide concise, professional feedback to guide the learner's improvement.
  `,
  [ResponseType.ESSAY]: `
    Critique the essay based on:
    - **Depth of Analysis**: Assess how well the essay examines the topic, including insights and critical thinking.
    - **Structure**: Comment on the clarity of the introduction, body, and conclusion.
    - **Clarity and Writing Style**: Evaluate grammar, vocabulary, and sentence structure for precision and readability.
    - **Evidence and References**: Determine the quality and appropriateness of sources cited or evidence provided.
    - **Argument Development**: Critique how well the arguments are articulated and supported.
    - **Creativity**: Note any unique perspectives or original ideas presented in the essay.
  `,
  [ResponseType.REPORT]: `
    Critique the report based on:
    - **Completeness**: Does the report cover all required points and provide sufficient depth?
    - **Data Presentation**: Evaluate the clarity and accuracy of tables, charts, or other visual aids.
    - **Organization**: Assess logical flow, headings, and layout for readability.
    - **Clarity of Communication**: Comment on grammar, syntax, and overall writing quality.
    - **Relevance**: Ensure that the content strictly adheres to the assignment objectives.
    - **Actionable Insights**: Highlight the value of conclusions or recommendations, if any.
  `,
  [ResponseType.PRESENTATION]: `
    Critique the presentation based on:
    - **Content Depth**: Evaluate the quality of information provided and its alignment with the question.
    - **Slide Design**: Assess visual appeal, readability, and effective use of graphics and text.
    - **Organization**: Comment on the sequence of ideas and how effectively they are conveyed.
    - **Engagement**: Determine whether the presentation would capture and maintain audience attention.
    - **Clarity of Explanation**: Ensure all points are clearly communicated with minimal ambiguity.
    - **Professionalism**: Evaluate adherence to professional standards in tone and design.
  `,
  [ResponseType.VIDEO]: `
    Critique the video submission based on:
    - **Content Accuracy**: Ensure the video covers the required material correctly and thoroughly.
    - **Presentation Skills**: Evaluate speech clarity, tone, pacing, and overall communication effectiveness.
    - **Visual and Audio Quality**: Assess lighting, sound, and any video effects used.
    - **Structure**: Comment on the logical flow and coherence of ideas.
    - **Engagement and Creativity**: Highlight how well the video captures attention and uses creative elements.
    - **Relevance**: Ensure all content aligns with the question's requirements.
  `,
  [ResponseType.AUDIO]: `
    Critique the audio submission based on:
    - **Content Relevance**: Verify that the audio content directly addresses the question or topic.
    - **Speech Clarity**: Assess pronunciation, tone, and pacing for effective communication.
    - **Audio Quality**: Identify issues like background noise, distortions, or low-quality recording.
    - **Engagement**: Highlight how effectively the audio holds listener attention.
    - **Logical Structure**: Ensure the audio follows a clear and logical progression.
    - **Creativity**: Recognize any unique or innovative approaches in the audio response.
  `,
  [ResponseType.SPREADSHEET]: `
    Critique the spreadsheet based on:
    - **Data Accuracy**: Verify correctness of all data inputs and outputs.
    - **Formulas and Functions**: Evaluate the correctness, efficiency, and clarity of formulas used.
    - **Formatting and Organization**: Comment on readability, cell alignment, and use of colors or themes.
    - **Visualization**: Assess the relevance and clarity of charts, graphs, or pivot tables included.
    - **Integration and Analysis**: Critique how well the spreadsheet integrates data and provides actionable insights.
    - **Complexity**: Recognize any advanced features (e.g., macros, advanced formulas) effectively implemented.
  `,
  [ResponseType.OTHER]: `
    Critique the submission based on:
    - **Relevance**: Ensure the response aligns with the question and context.
    - **Completeness**: Verify that the submission addresses all parts of the question.
    - **Quality of Execution**: Evaluate technical, visual, or written quality, depending on the medium.
    - **Originality**: Identify and commend any unique or creative approaches.
    - **Clarity**: Comment on how clearly the submission communicates its ideas.
    - **Adaptability**: Provide suggestions for improving areas that may require refinement.
  `,
  [ResponseType.REPO]: `
    Critique the repository based on:
    - **Code Quality**: Assess the cleanliness, readability, and maintainability of the code.
    - **Functionality**: Evaluate whether the code meets the requirements and functions as expected.
    - **Documentation**: Comment on the clarity and completeness of comments and documentation.
    - **Testing**: Evaluate the presence and effectiveness of tests and test coverage.
    - **Structure**: Assess the organization and modularity of the codebase.
    - **Best Practices**: Identify adherence to coding standards and best practices.
  `,
};

@Injectable()
export class LlmService {
  private readonly logger: Logger;
  private llm: ChatOpenAI;
  private tiktokenEncoding: Tiktoken;
  static readonly llmModelName: string = "gpt-4o";
  // -2024-08-06

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    private readonly prisma: PrismaService,
  ) {
    this.logger = parentLogger.child({ context: LlmService.name });
    this.llm = new ChatOpenAI({
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
  getDifficultyDescription = (difficulty: AssignmentTypeEnum) => {
    switch (difficulty) {
      case AssignmentTypeEnum.PRACTICE: {
        return "Surface-level, simple questions to reinforce understanding.";
      }
      case AssignmentTypeEnum.QUIZ: {
        return "Moderately challenging questions to test comprehension.";
      }
      case AssignmentTypeEnum.ASSINGMENT: {
        return "In-depth questions requiring detailed explanations or calculations.";
      }
      case AssignmentTypeEnum.MIDTERM: {
        return "Comprehensive questions that assess understanding of multiple topics.";
      }
      case AssignmentTypeEnum.FINAL: {
        return "Advanced, in-depth questions with follow-ups to evaluate mastery.";
      }
      default: {
        return "";
      }
    }
  };
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
    language?: string,
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
      responseType,
    } = fileBasedQuestionEvaluateModel;
    const validateLearnerResponse = await this.applyGuardRails(
      learnerResponse.map((item) => item.content).join(" "),
    );

    // Define a mapping from responseType to templates
    const templates: { [key in ResponseType]: string } = {
      [ResponseType.CODE]: gradeCodeFileQuestionLlmTemplate,
      [ResponseType.REPO]: gradeRepoQuestionLlmTemplate,
      [ResponseType.ESSAY]: gradeEssayFileQuestionLlmTemplate,
      [ResponseType.REPORT]: gradeEssayFileQuestionLlmTemplate,
      [ResponseType.PRESENTATION]: gradePresentationFileQuestionLlmTemplate,
      [ResponseType.VIDEO]: gradeVideoFileQuestionLlmTemplate,
      [ResponseType.AUDIO]: gradeAudioFileQuestionLlmTemplate,
      [ResponseType.SPREADSHEET]: gradeSpreadsheetFileQuestionLlmTemplate,
      [ResponseType.OTHER]: gradeDocumentFileQuestionLlmTemplate,
    };

    const selectedTemplate = templates[responseType];

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
          learnerResponse.map((item) => ({
            filename: item.filename,
            content: item.content,
          })),
        ),
        total_points: totalPoints.toString(),
        scoring_type: scoringCriteriaType,
        scoring_criteria: JSON.stringify(scoringCriteria),
        grading_type: responseType,
        language: language ?? "en",
      },
    });

    // Define the format for the output as separate values instead of JSON
    const response = await this.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
    );
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
    language?: string,
  ): Promise<TextBasedQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      responseType,
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
    // Add response-specific instructions
    const responseSpecificInstruction =
      responseTypeSpecificInstructions[responseType] ?? "";
    const prompt = new PromptTemplate({
      template: gradeTextBasedQuestionLlmTemplate,
      inputVariables: [],
      partialVariables: {
        question: question,
        assignment_instructions: assignmentInstrctions,
        responseSpecificInstruction: responseSpecificInstruction,
        previous_questions_and_answers: JSON.stringify(
          previousQuestionsAnswersContext,
        ),
        learner_response: learnerResponse,
        total_points: totalPoints.toString(),
        scoring_type: scoringCriteriaType,
        scoring_criteria: JSON.stringify(scoringCriteria),
        format_instructions: formatInstructions,
        grading_type: responseType,
        language: language ?? "en",
      },
    });
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
    language?: string,
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
      responseType,
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

    // Add response-specific instructions
    const responseSpecificInstruction =
      responseTypeSpecificInstructions[responseType] ?? "";

    const prompt = new PromptTemplate({
      template: gradeUrlBasedQuestionLlmTemplate,
      inputVariables: [],
      partialVariables: {
        question: question,
        assignment_instructions: assignmentInstrctions,
        responseSpecificInstruction: responseSpecificInstruction,
        previous_questions_and_answers: JSON.stringify(
          previousQuestionsAnswersContext,
        ),
        url_provided: urlProvided,
        url_body: urlBody,
        is_url_functional: isUrlFunctional ? "functional" : "not functional",
        total_points: totalPoints.toString(),
        scoring_type: scoringCriteriaType,
        scoring_criteria: JSON.stringify(scoringCriteria),
        format_instructions: formatInstructions,
        grading_type: responseType,
        language: language ?? "en",
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
    // Base schema for a question
    const baseQuestionSchema = z.object({
      id: z.number().describe("Unique identifier for the variation"),
      variantContent: z
        .string()
        .describe("A reworded variation of the question text"),
    });

    // Schema for TRUE_FALSE questions
    const trueFalseQuestionItemSchema = baseQuestionSchema.extend({
      type: z.literal("TRUE_FALSE"),
      choices: z
        .array(
          z.object({
            choice: z.enum(["True", "False"]),
            points: z.number().min(1),
            feedback: z.string().optional(),
            isCorrect: z
              .boolean()
              .refine(
                (value) => value === true,
                "Only true can be correct for a true/false question",
              ),
          }),
        )
        .length(1),
    });

    // Schema for MULTIPLE_CORRECT questions
    const multipleCorrectQuestionItemSchema = baseQuestionSchema.extend({
      type: z.literal("MULTIPLE_CORRECT"),
      choices: z
        .array(
          z.object({
            choice: z.string(),
            points: z.number(),
            feedback: z.string().optional(),
            isCorrect: z.boolean(),
          }),
        )
        .min(2), // Ensures at least two choices
    });

    // Schema for SINGLE_CORRECT questions
    const singleCorrectQuestionItemSchema = baseQuestionSchema.extend({
      type: z.literal("SINGLE_CORRECT"),
      choices: z
        .array(
          z.object({
            choice: z.string(),
            points: z.number().min(0),
            feedback: z.string().optional(),
            isCorrect: z.boolean(),
          }),
        )
        .refine(
          (choices) =>
            choices.filter((choice) => choice.isCorrect).length === 1,
          { message: "Exactly one choice must be marked as correct" },
        ),
    });
    const singleCorrectQuestionSchema = z
      .array(singleCorrectQuestionItemSchema)
      .min(1)
      .max(variationCount);
    const multipleCorrectQuestionSchema = z
      .array(multipleCorrectQuestionItemSchema)
      .min(1)
      .max(variationCount);
    const trueFalseQuestionSchema = z
      .array(trueFalseQuestionItemSchema)
      .min(1)
      .max(variationCount);

    const textBasedQuestionSchema = baseQuestionSchema
      .extend({
        type: z.literal("TEXT"),
      })
      .array()
      .min(1)
      .max(variationCount);
    const urlBasedQuestionSchema = baseQuestionSchema
      .extend({
        type: z.literal("URL"),
      })
      .array()
      .min(1)
      .max(variationCount);
    const parser = (() => {
      switch (questionType) {
        case QuestionType.TRUE_FALSE: {
          return StructuredOutputParser.fromZodSchema(trueFalseQuestionSchema);
        }
        case QuestionType.MULTIPLE_CORRECT: {
          return StructuredOutputParser.fromZodSchema(
            multipleCorrectQuestionSchema,
          );
        }
        case QuestionType.SINGLE_CORRECT: {
          return StructuredOutputParser.fromZodSchema(
            singleCorrectQuestionSchema,
          );
        }
        case QuestionType.TEXT: {
          return StructuredOutputParser.fromZodSchema(textBasedQuestionSchema);
        }
        case QuestionType.UPLOAD:
        case QuestionType.LINK_FILE:
        case QuestionType.URL: {
          return StructuredOutputParser.fromZodSchema(urlBasedQuestionSchema);
        }
        default: {
          return StructuredOutputParser.fromZodSchema(baseQuestionSchema);
        }
      }
    })();

    const formatInstructions = parser.getFormatInstructions();

    const promptTemplate = (() => {
      switch (questionType) {
        case QuestionType.MULTIPLE_CORRECT:
        case QuestionType.SINGLE_CORRECT: {
          return generateQuestionWithChoicesRewordingsTemplate;
        }
        case QuestionType.TRUE_FALSE: {
          return generateQuestionWithTrueFalseRewordingsTemplate;
        }
        default: {
          return generateQuestionRewordingsTemplate;
        }
      }
    })();

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
    return (
      Array.isArray(parsedResponse) // Check if parsedResponse is an array
        ? parsedResponse
        : [parsedResponse]
    ).map((item, index) => ({
      id:
        (item as { id: number }).id ??
        (typeof index === "number" ? index + 1 : 1),
      variantContent: (item as { variantContent: string }).variantContent ?? "",
      choices: (
        (
          item as {
            choices: {
              choice: string;
              feedback: string;
              isCorrect: boolean;
              points: number;
            }[];
          }
        ).choices ?? []
      ).map(
        (
          rewordedChoice: {
            choice: string;
            feedback: string;
            isCorrect: boolean;
            points: number;
          },
          choiceIndex: number,
        ) => ({
          choice: rewordedChoice.choice ?? choices?.[choiceIndex]?.choice ?? "",
          points: rewordedChoice.points ?? choices?.[choiceIndex]?.points ?? 1,
          feedback:
            rewordedChoice.feedback ?? choices?.[choiceIndex]?.feedback ?? "",
          isCorrect: rewordedChoice.isCorrect === true,
        }),
      ),
    }));
  }
  /**
   * Creates or refines a rubric (ScoringDto) for a question.
   * - If the question already has rubrics, the LLM will refine or expand them.
   * - If the question has no rubrics, the LLM will create them from scratch.
   */
  public async createMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
    rubricIndex?: number,
  ): Promise<ScoringDto> {
    // 1) Map question.type to the correct rubric template
    const rubricTemplates = {
      TEXT: generateTextBasedMarkingRubricTemplate,
      URL: generateUrlBasedMarkingRubricTemplate,
      UPLOAD: generateDocumentFileUploadMarkingRubricTemplate,
      LINK_FILE: generateDocumentFileUploadMarkingRubricTemplate,
    };
    const selectedTemplate =
      rubricTemplates[question.type as keyof typeof rubricTemplates];

    // If no matching rubric template, just return an empty scoring object
    if (!selectedTemplate) {
      return {
        type: ScoringType.CRITERIA_BASED,
        rubrics: [],
      };
    }

    // 2) Prepare any existing rubrics JSON
    const existingRubricsJson = question.scoring?.rubrics?.length
      ? JSON.stringify(question.scoring.rubrics)
      : "[]";

    // 3) Build a Zod schema for the LLM to return *only* scoring
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        scoring: z
          .object({
            type: z
              .enum(["CRITERIA_BASED"])
              .optional()
              .describe("Manual grading rubric scoring"),
            rubrics: z
              .array(
                z.object({
                  rubricQuestion: z
                    .string()
                    .describe(
                      "A question evaluating a key aspect of the response. Each rubric question focuses on a specific evaluation criterion.",
                    ),
                  criteria: z
                    .array(
                      z.object({
                        // We'll treat `id` as optional from the LLM
                        id: z.number().optional(),
                        description: z.string().describe("Criterion detail"),
                        points: z.number().describe("Points if met").int(),
                      }),
                    )
                    .min(2, "At least 2 criteria needed")
                    .describe("List of grading criteria"),
                }),
              )
              .optional(),
          })
          .nullable()
          .optional(),
      }),
    );
    const formatInstructions = parser.getFormatInstructions();

    // 4) Construct a "wrapper prompt"
    //    We'll build instructions based on whether or not a rubricIndex was given
    let wrapperTemplate = `
      You are an AI assistant that creates or modifies scoring rubrics.
      The question is:
      {question_json}

      Existing rubrics (if any):
      {existing_rubrics_json}

      Return valid JSON according to the schema. 
      Do not include any text or explanations outside of the JSON. 
      Do not include code fences. 
      Do not include the schema itself in your output.
    `;
    const existingRubricOfIndex = question.scoring.rubrics[rubricIndex];
    const existingRubricOfIndexJson = JSON.stringify(existingRubricOfIndex);

    // 5) Build specialized instructions if rubricIndex is provided
    if (rubricIndex !== undefined && question.scoring?.rubrics) {
      // Try to fetch the existing rubric at the given index
      if (existingRubricOfIndex) {
        // Check if it's "complete"
        console.log(
          "this.isRubricComplete(existingRubricOfIndex)",
          this.isRubricComplete(existingRubricOfIndex),
        );
        wrapperTemplate += this.isRubricComplete(existingRubricOfIndex)
          ? `
            The rubric {existingRubricOfIndexJson} is complete.
            Create a *distinct* or *alternative* criteria and rubric question that addresses the question
            from a different angle or with different criteria.
            Do NOT just refine the existing rubric: it should be an entirely new approach.
          `
          : `
            The rubric at index {existingRubricOfIndexJson} is incomplete.
            Improve or finalize this rubric so it has enough well-defined criteria
            to thoroughly assess the question.
            Keep the existing rubricQuestion, but fill in missing criteria points and description.
            Only return the new or updated criteria for this rubric.
          `;
      } else {
        // If there's no rubric at that index, just create from scratch
        wrapperTemplate += `
          Create a new rubric from scratch with multiple well-defined criteria.
        `;
      }
    } else {
      // If no rubricIndex, we create a new rubric from scratch
      wrapperTemplate += `
        Create a new rubric from scratch with multiple well-defined criteria.
      `;
    }

    // Add the base template instructions
    wrapperTemplate += `
      Use the following rubric instructions as a guide:
      ${selectedTemplate}
    `;

    // 6) Prepare the LLM prompt
    const prompt = new PromptTemplate({
      template: wrapperTemplate,
      inputVariables: [],
      partialVariables: {
        question_json: JSON.stringify(question),
        existing_rubrics_json: existingRubricsJson,
        format_instructions: formatInstructions,
        response_type: question.responseType ?? "no type set",
        existingRubricOfIndexJson: existingRubricOfIndexJson || "null",
      },
    });

    // 7) Send prompt to LLM
    let response: string;
    try {
      response = await this.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.QUESTION_GENERATION,
      );
    } catch (error) {
      this.logger.error(`Error generating rubric: ${(error as Error).message}`);
      throw new HttpException(
        "Failed to generate rubric",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 8) Parse the LLM response into { scoring }
    let parsed: { scoring?: ScoringDto } = {};
    try {
      parsed = (await parser.parse(response)) as { scoring?: ScoringDto };
    } catch (error) {
      this.logger.error(`Error parsing rubric: ${(error as Error).message}`);
      throw new HttpException(
        "Invalid rubric format returned by LLM",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 9) Build a final ScoringDto from the LLM response
    const scoringData = parsed.scoring;
    if (!scoringData?.rubrics) {
      return {
        type: ScoringType.CRITERIA_BASED,
        rubrics: [],
      };
    }

    const finalScoring: ScoringDto = {
      type: scoringData.type || ScoringType.CRITERIA_BASED,
      rubrics: scoringData.rubrics.map((r: RubricDto) => {
        return {
          rubricQuestion: r.rubricQuestion,
          criteria: r.criteria.map((c: Criteria) => ({
            description: c.description,
            points: c.points,
          })),
        };
      }),
    };

    return finalScoring;
  }
  public async expandMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
  ): Promise<ScoringDto> {
    // 1) Choose the correct template for the question type.
    const rubricTemplates = {
      TEXT: generateTextBasedMarkingRubricTemplate,
      URL: generateUrlBasedMarkingRubricTemplate,
      UPLOAD: generateDocumentFileUploadMarkingRubricTemplate,
      LINK_FILE: generateDocumentFileUploadMarkingRubricTemplate,
    };

    const selectedTemplate =
      rubricTemplates[question.type as keyof typeof rubricTemplates];

    if (!selectedTemplate) {
      // If no specialized template, just return existing rubrics or an empty set
      return (
        question.scoring || {
          type: ScoringType.CRITERIA_BASED,
          rubrics: [],
        }
      );
    }

    // 2) Read existing rubrics from the question. If none, start with []
    const existingRubrics = question.scoring?.rubrics ?? [];
    // 3) Build a Zod parser for the LLM output (expects { scoring?: { rubrics?: [...] } })
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        scoring: z
          .object({
            type: z
              .enum(["CRITERIA_BASED"])
              .optional()
              .describe("Rubric scoring method"),
            rubrics: z
              .array(
                z.object({
                  rubricQuestion: z
                    .string()
                    .describe("Rubric question/heading"),
                  criteria: z
                    .array(
                      z.object({
                        id: z.number().optional().describe("Criterion ID"),
                        description: z.string().describe("Criterion detail"),
                        points: z
                          .number()
                          .describe("Points if criterion is met"),
                      }),
                    )
                    .min(2, "At least two criteria required"),
                }),
              )
              .optional(),
          })
          .nullable()
          .optional(),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    // 4) Build the prompt. We specifically ask for new rubrics:
    const wrapperTemplate = `
      You are an AI that extends a question's existing rubrics by adding new rubrics or criteria.
      Do NOT modify or remove existing rubrics; only add new, distinct rubric(s) focusing on aspects not already covered.

      The question is:
      {question_json}

      Existing rubrics:
      {existing_rubrics_json}

      If there are no rubrics, create them from scratch. 
      If there are some rubrics, only add new rubrics for missing or uncovered facets.

      Use the following guidelines to structure each rubric:
      ${selectedTemplate}
    `;
    const prompt = new PromptTemplate({
      template: wrapperTemplate,
      inputVariables: [],
      partialVariables: {
        question_json: JSON.stringify(question),
        existing_rubrics_json: JSON.stringify(existingRubrics) || "[]",
        format_instructions: formatInstructions,
        response_type: question?.responseType ?? "no type set",
      },
    });

    // 5) Call the LLM
    let response: string;
    try {
      response = await this.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.QUESTION_GENERATION,
      );
    } catch (error) {
      this.logger.error(`Error expanding rubric: ${(error as Error).message}`);
      throw new HttpException(
        "Failed to expand marking rubric",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 6) Parse the LLM response into { scoring }
    let parsed: { scoring?: ScoringDto } = {};
    try {
      parsed = (await parser.parse(response)) as { scoring?: ScoringDto };
    } catch (error) {
      this.logger.error(`LLM parse error: ${(error as Error).message}`);
      throw new HttpException(
        "LLM returned invalid data while expanding rubric",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 7) If no new rubrics returned, we just keep what we had
    const newRubrics = parsed.scoring?.rubrics ?? [];
    if (newRubrics.length === 0) {
      return {
        type: question.scoring?.type || ScoringType.CRITERIA_BASED,
        rubrics: existingRubrics,
      };
    }

    // 8) Merge the new rubrics on top of the existing rubrics
    const combinedRubrics = [...existingRubrics];

    // For each newly generated rubric, check if we want to add or skip duplicates
    for (const r of newRubrics) {
      const newRubric: RubricDto = {
        rubricQuestion: r.rubricQuestion,
        criteria: r.criteria.map((c: Criteria) => ({
          description: c.description,
          points: c.points,
        })),
      };

      // Check if there's already a rubricQuestion with the same text and only push if it's truly new:
      const existingFound = combinedRubrics.find(
        (ex) => ex.rubricQuestion === newRubric.rubricQuestion,
      );
      if (!existingFound) {
        combinedRubrics.push(newRubric);
      }
    }

    // 9) Return the combined set
    const finalScoring: ScoringDto = {
      type: ScoringType.CRITERIA_BASED,
      rubrics: combinedRubrics,
    };

    return finalScoring;
  }
  /**
   * Creates or refines the choices for a choice-based question
   * (SINGLE_CORRECT or MULTIPLE_CORRECT).
   */
  public async createChoices(
    question: QuestionDto,
    assignmentId: number,
  ): Promise<Choice[]> {
    if (
      question.type !== "SINGLE_CORRECT" &&
      question.type !== "MULTIPLE_CORRECT"
    ) {
      return [];
    }
    // Map to the correct template
    const choiceTemplates = {
      SINGLE_CORRECT: generateSingleBasedMarkingRubricTemplate,
      MULTIPLE_CORRECT: generateMultipleBasedMarkingRubricTemplate,
    };
    const selectedTemplate = choiceTemplates[question.type];

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        choices: z
          .array(
            z.object({
              choice: z.string().describe("Answer text"),
              id: z.number().describe("Unique identifier"),
              isCorrect: z.boolean().describe("Correct or not"),
              points: z.number().describe("Points for this choice"),
              feedback: z.string().optional().describe("Feedback text"),
            }),
          )
          .describe("Choice-based question answers"),
      }),
    );
    const formatInstructions = parser.getFormatInstructions();
    const prompt = new PromptTemplate({
      template: selectedTemplate,
      inputVariables: [],
      partialVariables: {
        question_json_array: JSON.stringify(question),
        format_instructions: formatInstructions,
      },
    });

    // Send prompt to LLM
    let response: string;
    try {
      response = await this.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.QUESTION_GENERATION,
      );
    } catch (error) {
      this.logger.error(
        `Error generating choices: ${(error as Error).message}`,
      );
      // Return empty or throw, as you prefer
      return [];
    }

    // Parse the response
    let parsed: { choices: Choice[] } = { choices: [] };
    try {
      parsed = (await parser.parse(response)) as { choices: Choice[] };
    } catch (error) {
      this.logger.error(`Error parsing choices:  ${(error as Error).message}`);
      return [];
    }

    // Convert raw data to your Choice[] type
    const finalChoices: Choice[] = parsed.choices.map((ch) => ({
      choice: ch.choice,
      isCorrect: ch.isCorrect,
      points: ch.points,
      feedback: ch.feedback,
    }));

    return finalChoices;
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
    learningObjectives?: string,
  ): Promise<
    {
      question: string;
      totalPoints: number;
      type: QuestionType;
      scoring: {
        type: string;
        rubrics?: RubricDto[];
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
      scoring: ScoringDto;
      choices?: {
        choice: string;
        isCorrect: boolean;
        points: number;
        feedback: string;
      }[];
    }[]; // Ensure the response contains a `questions` array
  }
  // Helper to ensure the array length matches a desired count
  ensureCount = (
    array: any[],
    needed: number,
    defaultQuestion: Partial<(typeof array)[number]>,
  ) => {
    // If the LLM provided too many, slice
    if (array.length > needed) {
      return array.slice(0, needed) as {
        question: string;
        type: QuestionType;
        scoring?: ScoringDto;
        choices?: {
          choice: string;
          id: number;
          isCorrect: boolean;
          points: number;
          feedback?: string;
        }[];
      }[];
    }
    // If too few, add placeholders
    while (array.length < needed) {
      array.push({
        ...defaultQuestion,
        // A naive ID generator—replace with your own logic if needed
        id: Date.now() + Math.floor(Math.random() * 10_000),
      });
    }
    return array as {
      question: string;
      type: QuestionType;
      scoring?: ScoringDto;
      choices?: {
        choice: string;
        id: number;
        isCorrect: boolean;
        points: number;
        feedback?: string;
      }[];
    }[];
  };

  /**
   * This function ensures the final output always has the exact number of
   * questions requested for each type (without hard failing).
   */
  private async processPromptWithQuestionTemplate(
    assignmentId: number,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: QuestionsToGenerate,
    content?: string,
    learningObjectives?: string,
  ): Promise<{ questions: any[] }> {
    // 1. Figure out how many total questions the user wants
    const totalQuestionsToGenerate =
      questionsToGenerate.multipleChoice +
      questionsToGenerate.multipleSelect +
      questionsToGenerate.textResponse +
      questionsToGenerate.trueFalse;

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
                type: z
                  .enum(["CRITERIA_BASED"])
                  .optional()
                  .describe("Manual grading rubric scoring"),
                rubrics: z
                  .array(
                    z.object({
                      rubricQuestion: z
                        .string()
                        .describe(
                          "A question evaluating a key aspect of the response. Each rubric question focuses on a specific evaluation criterion.",
                        ),
                      criteria: z
                        .array(
                          z.object({
                            id: z.number().optional(),
                            description: z
                              .string()
                              .describe("Criterion detail"),
                            points: z.number().describe("Points if met").int(),
                          }),
                        )
                        .min(2, "At least 2 criteria needed")
                        .describe("List of grading criteria"),
                    }),
                  )
                  .min(2)
                  .describe("Scoring rubrics for the question")
                  .optional(),
              })
              .nullable()
              .optional(),
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

    // 3. Select the appropriate template for the LLM based on parameters
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
    // 4. Get the parser format instructions
    const formatInstructions = parser.getFormatInstructions();

    // 5. Build the PromptTemplate
    const promptTemplate = new PromptTemplate({
      template: pickGenerateAssignmentQuestionsTemplate,
      inputVariables: [],
      partialVariables: {
        format_instructions: formatInstructions,
        content: content ?? "",
        totalQuestionsToGenerate: totalQuestionsToGenerate.toString(),
        learning_objectives: learningObjectives ?? "",
        questionsToGenerate: JSON.stringify(questionsToGenerate),
        multipleChoice: questionsToGenerate.multipleChoice.toString(),
        multipleSelect: questionsToGenerate.multipleSelect.toString(),
        textResponse: questionsToGenerate.textResponse.toString(),
        trueFalse: questionsToGenerate.trueFalse.toString(),
        difficultyDescription: this.getDifficultyDescription(assignmentType),
        assignment_type: assignmentType,
      },
    });

    // 6. Send to LLM & parse the response with Zod
    const response = await this.processPrompt(
      promptTemplate,
      assignmentId,
      AIUsageType.ASSIGNMENT_GENERATION,
    );
    const parsedResponse = await parser.parse(response);
    // remove any markdown anotation from the questions
    parsedResponse.questions = parsedResponse.questions.map((question) => {
      question.question = question.question?.replaceAll("```", "");
      if (question.choices) {
        question.choices = question.choices.map((choice) => {
          choice.feedback = choice.feedback?.replaceAll("```", "");
          return choice;
        });
      }
      return question;
    });
    let questions = parsedResponse.questions;

    // 7. Separate questions by their type
    const singleCorrectQs = questions.filter(
      (q) => q.type === "SINGLE_CORRECT",
    );
    const multipleCorrectQs = questions.filter(
      (q) => q.type === "MULTIPLE_CORRECT",
    );
    const textQs = questions.filter((q) => q.type === "TEXT");
    const trueFalseQs = questions.filter((q) => q.type === "TRUE_FALSE");

    // 8. Match the requested counts for each type
    const finalSingleCorrect = this.ensureCount(
      singleCorrectQs,
      questionsToGenerate.multipleChoice,
      {
        question: "Placeholder single-correct question",
        type: "SINGLE_CORRECT",
        scoring: undefined,
        choices: [],
      },
    );

    const finalMultipleCorrect = this.ensureCount(
      multipleCorrectQs,
      questionsToGenerate.multipleSelect,
      {
        question: "Placeholder multiple-correct question",
        type: "MULTIPLE_CORRECT",
        scoring: undefined,
        choices: [],
      },
    );

    const finalText = this.ensureCount(
      textQs,
      questionsToGenerate.textResponse,
      {
        question: "Placeholder text question",
        type: "TEXT",
        scoring: undefined,
        choices: undefined,
      },
    );

    const finalTrueFalse = this.ensureCount(
      trueFalseQs,
      questionsToGenerate.trueFalse,
      {
        question: "Placeholder true/false question",
        type: "TRUE_FALSE",
        scoring: undefined,
        choices: [
          {
            choice: "True",
            id: 1,
            isCorrect: false,
            points: 0,
            feedback: "Placeholder feedback for True",
          },
          {
            choice: "False",
            id: 2,
            isCorrect: false,
            points: 0,
            feedback: "Placeholder feedback for False",
          },
        ],
      },
    );

    // 9. Combine the final arrays into one array
    questions = [
      ...finalSingleCorrect,
      ...finalMultipleCorrect,
      ...finalText,
      ...finalTrueFalse,
    ].map((question) => ({
      ...question,
      type: question.type as
        | "TEXT"
        | "SINGLE_CORRECT"
        | "MULTIPLE_CORRECT"
        | "TRUE_FALSE",
      scoring: question.scoring
        ? { ...question.scoring, type: "CRITERIA_BASED" }
        : undefined,
    }));

    // 10. Return final distribution
    return { questions };
  }
  async getLanguageCode(text: string): Promise<string> {
    try {
      const response: {
        readonly reliable: boolean;
        readonly textBytes: number;
        readonly languages: cld.Language[];
        readonly chunks: cld.Chunk[];
      } = (await cld.detect(text)) as {
        reliable: boolean;
        textBytes: number;
        languages: cld.Language[];
        chunks: cld.Chunk[];
      };
      return response.languages[0].code;
    } catch {
      return "unknown";
    }
  }
  /**
   * Translates the choices of a question into the specified target language.
   * @param choices The array of choices to translate.
   * @param targetLanguage The target language for translation.
   * @returns The translated choices.
   */
  async generateChoicesTranslation(
    choices: Choice[],
    assignmentId: number,
    targetLanguage: string,
  ): Promise<Choice[]> {
    // Define the Zod schema for validating LLM response
    const choicesTranslationSchema = z.object({
      translatedChoices: z.array(
        z.object({
          choice: z.string().nonempty("Choice text cannot be empty"),
          isCorrect: z.boolean(),
          points: z.number(),
          feedback: z.string().optional(),
        }),
      ),
    });

    const promptTemplate = `
  Translate the following choices into {target_language}. Ensure the output adheres to the specified JSON format.
  Choices: {choices_json}
  {format_instructions}
  `;
    const parser = StructuredOutputParser.fromZodSchema(
      choicesTranslationSchema,
    );
    const formatInstructions = parser.getFormatInstructions();
    const prompt = new PromptTemplate({
      template: promptTemplate,
      inputVariables: [],
      partialVariables: {
        choices_json: JSON.stringify(choices),
        target_language: targetLanguage,
        format_instructions: formatInstructions,
      },
    });

    try {
      // Send the formatted prompt to LLM and get the raw response
      const rawResponse = await this.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.TRANSLATION,
      );

      // Clean the raw response to remove Markdown-style code block markers
      const cleanedResponse = rawResponse
        .replaceAll(/```(?:json|)/g, "")
        .trim();

      // Validate the response using the Zod schema
      const parsedResponse = choicesTranslationSchema.parse(
        JSON.parse(cleanedResponse),
      );

      // Map the parsed response to the expected structure
      return parsedResponse.translatedChoices.map((choice) => ({
        choice: choice.choice.trim(),
        isCorrect: choice.isCorrect,
        points: choice.points,
        feedback: choice.feedback?.trim() || undefined, // Ensure feedback is optional
      }));
    } catch (error) {
      this.logger.error(
        `Error translating choices: ${(error as Error).message}`,
      );
      throw new HttpException(
        "Failed to translate choices",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Generate a machine translation for the given text.
   * @param text The text to be translated.
   * @param language The target language for translation (e.g., French, Spanish).
   * @returns The translated text.
   */
  async generateQuestionTranslation(
    assignmentId: number,
    questionText: string,
    targetLanguage: string,
  ): Promise<string> {
    // remove any html tags from the question text
    questionText = questionText.replaceAll(/<[^>]*>?/gm, "");
    const questionTranslationSchema = StructuredOutputParser.fromZodSchema(
      z.object({
        translatedText: z.string().nonempty("Translated text cannot be empty"),
      }),
    );
    const format_instructions =
      questionTranslationSchema.getFormatInstructions();
    const prompt = new PromptTemplate({
      template: translateQuestionTemplate,
      inputVariables: [],
      partialVariables: {
        question_text: questionText,
        target_language: targetLanguage,
        format_instructions: format_instructions,
      },
    });

    try {
      const response = await this.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.TRANSLATION,
      );
      const parsedResponse = await questionTranslationSchema.parse(response);
      return parsedResponse.translatedText;
    } catch (error) {
      this.logger.error(
        `Error translating question: ${(error as Error).message}`,
      );
      throw new HttpException(
        "Failed to translate question",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // a function that asks the llm to translate a text to a target language
  async translateText(
    text: string,
    targetLanguage: string,
    assignmentId: number,
  ): Promise<string> {
    if (!text) {
      return;
    }
    // Define the Zod schema for validating LLM response
    const translationSchema = z.object({
      translatedText: z.string().nonempty("Translated text cannot be empty"),
    });

    const promptTemplate = `
  Translate the following text into {target_language}.
  Please provide only a valid JSON object that conforms exactly to the following format:
  {format_instructions}
  Text: {text}
  Do not include any additional text, commentary, or formatting.
  `;
    const parser = StructuredOutputParser.fromZodSchema(translationSchema);
    const formatInstructions = parser.getFormatInstructions();
    const prompt = new PromptTemplate({
      template: promptTemplate,
      inputVariables: [],
      partialVariables: {
        text: text,
        target_language: targetLanguage,
        format_instructions: formatInstructions,
      },
    });

    try {
      // Send the formatted prompt to LLM and get the raw response
      const rawResponse = await this.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.TRANSLATION,
      );

      // Validate the response using the Zod schema
      const parsedResponse = translationSchema.parse(JSON.parse(rawResponse));

      return parsedResponse.translatedText;
    } catch (error) {
      this.logger.error(`Error translating text: ${(error as Error).message}`);
      throw new HttpException(
        "Failed to translate text",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // private methods
  private async processPrompt(
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
  ): Promise<string> {
    const input = await prompt.format({});

    // Get token counts
    const inputTokens = this.tiktokenEncoding.encode(input).length;
    this.logger.info(`Input token count: ${inputTokens}`);

    // Invoke the chat model properly
    const result = await this.llm.invoke([new HumanMessage(input)]);
    let response = result.content.toString();

    response = response
      .replaceAll("```json", "") // Remove json code blocks
      .replaceAll("```", "") // Remove any remaining code blocks
      .replaceAll("`", "") // Remove single backticks
      .trim(); // Trim whitespace

    try {
      JSON.parse(response); // Check if response is valid JSON
    } catch {
      // If not, return the response as is
      return response;
    }

    // Get response tokens
    const responseTokens = this.tiktokenEncoding.encode(response).length;
    this.logger.info(`Output token count: ${responseTokens}`);

    // Track usage
    await this.trackAIUsage(
      assignmentId,
      usageType,
      inputTokens,
      responseTokens,
    );

    return response;
  }
  private isRubricComplete(rubric: RubricDto): boolean {
    // Must have at least 2 criteria
    if (!rubric.criteria || rubric.criteria.length < 2) {
      return false;
    }

    for (const c of rubric.criteria) {
      console.log("c.description", c.description);
      if (!c.description || !c.description.trim()) {
        false;
        continue;
      }
    }

    // Each criterion must have a non-empty description
    for (const c of rubric.criteria) {
      if (!c.description || !c.description.trim()) {
        return false;
      }
    }

    return true;
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
