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
  ResponseType,
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
  generateLinkFileUploadMarkingRubricTemplate,
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
  gradeSpreadsheetFileQuestionLlmTemplate,
  gradeTextBasedQuestionLlmTemplate,
  gradeUrlBasedQuestionLlmTemplate,
  gradeVideoFileQuestionLlmTemplate,
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
};

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
    questions: {
      id: number;
      questionText: string;
      questionType: string;
      responseType?: ResponseType;
    }[],
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
      LINK_FILE: generateDocumentFileUploadMarkingRubricTemplate,
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
      const responseType = question.responseType;
      const formatInstructions = parser.getFormatInstructions();
      const prompt = new PromptTemplate({
        template: selectedTemplate,
        inputVariables: [],
        partialVariables: {
          questions_json_array: JSON.stringify([question]),
          format_instructions: formatInstructions,
          grading_style:
            responseType !== "OTHER" && responseType !== undefined
              ? `The rubric should ensure that the learner responds in ${responseType} format. Focus on evaluating the structure, content organization, and adherence to the expected conventions of a ${responseType}, including clarity, relevance, and formatting requirements.`
              : "",
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
          question.questionType === "IMAGES" ||
          question.questionType === "LINK_FILE"
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
    learningObjectives?: string,
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
    learningObjectives?: string,
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
