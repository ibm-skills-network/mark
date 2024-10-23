import { get_encoding, type Tiktoken } from "@dqbd/tiktoken";
import type { BaseLanguageModel as BaseLLM } from "@langchain/core/language_models/base";
import { PromptTemplate } from "@langchain/core/prompts";
import { OpenAI } from "@langchain/openai";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { OpenAIModerationChain } from "langchain/chains";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import type { Logger } from "winston";
import { z } from "zod";
import { Choice } from "../assignment/dto/update.questions.request.dto";
import type { ChoiceBasedQuestionEvaluateModel } from "./model/choice.based.question.evaluate.model";
import {
  ChoiceBasedQuestionResponseModel,
  type ChoiceBasedFeedback,
} from "./model/choice.based.question.response.model";
import type { TextBasedQuestionEvaluateModel } from "./model/text.based.question.evaluate.model";
import type { TextBasedQuestionResponseModel } from "./model/text.based.question.response.model";
import type { TrueFalseBasedQuestionEvaluateModel } from "./model/true.false.based.question.evaluate.model";
import { TrueFalseBasedQuestionResponseModel } from "./model/true.false.based.question.response.model";
import type { UrlBasedQuestionEvaluateModel } from "./model/url.based.question.evaluate.model";
import type { UrlBasedQuestionResponseModel } from "./model/url.based.question.response.model";
import {
  feedbackChoiceBasedQuestionLlmTemplate,
  feedbackTrueFalseBasedQuestionLlmTemplate,
  generateMarkingRubricTemplate,
  generateMultipleBasedMarkingRubricTemplate,
  generateQuestionsGradingContext,
  generateQuestionVariationsTemplate,
  generateSingleBasedMarkingRubricTemplate,
  generateTextBasedMarkingRubricTemplate,
  generateUrlBasedMarkingRubricTemplate,
  gradeTextBasedQuestionLlmTemplate,
  gradeUrlBasedQuestionLlmTemplate,
} from "./templates";

@Injectable()
export class LlmService {
  private readonly logger: Logger;
  private llm: BaseLLM;
  private tiktokenEncoding: Tiktoken;

  static readonly llmModelName: string = "gpt-4o-2024-05-13";

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
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

  async generateQuestionGradingContext(
    questions: { id: number; questionText: string }[],
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

    const response = await this.processPrompt(prompt);
    const parsedResponse = await parser.parse(response);
    const gradingContextQuestionMap: Record<number, number[]> = {};
    for (const item of parsedResponse) {
      gradingContextQuestionMap[item.questionId] = item.contextQuestions;
    }
    return gradingContextQuestionMap;
  }

  async gradeTextBasedQuestion(
    textBasedQuestionEvaluateModel: TextBasedQuestionEvaluateModel,
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

    const response = await this.processPrompt(prompt);

    const textBasedQuestionResponseModel = (await parser.parse(
      response,
    )) as TextBasedQuestionResponseModel;

    return textBasedQuestionResponseModel;
  }

  async gradeUrlBasedQuestion(
    urlBasedQuestionEvaluateModel: UrlBasedQuestionEvaluateModel,
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

    const response = await this.processPrompt(prompt);

    const urlBasedQuestionResponseModel = (await parser.parse(
      response,
    )) as UrlBasedQuestionResponseModel;

    return urlBasedQuestionResponseModel;
  }
  async generateQuestionVariations(
    outline: string,
    concepts: string[],
  ): Promise<string[]> {
    const parser = StructuredOutputParser.fromZodSchema(
      z
        .array(
          z
            .string()
            .describe(
              "A variation of the question based on the outline and concepts",
            ),
        )
        .describe("Array of question variations"),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: generateQuestionVariationsTemplate,
      inputVariables: [],
      partialVariables: {
        outline: outline,
        concepts: JSON.stringify(concepts),
        format_instructions: formatInstructions,
      },
    });

    const response = await this.processPrompt(prompt);
    const questionVariations = await parser.parse(response);

    return questionVariations;
  }
  async createMarkingRubric(
    questions: { id: number; questionText: string; questionType: string }[],
  ): Promise<
    Record<
      number,
      | string
      | { choices: Choice[] }
      | { id: number; description: string; points: number }[]
    >
  > {
    const templates = {
      TEXT: generateTextBasedMarkingRubricTemplate,
      URL: generateUrlBasedMarkingRubricTemplate,
      MULTIPLE_CORRECT: generateMultipleBasedMarkingRubricTemplate,
      SINGLE_CORRECT: generateSingleBasedMarkingRubricTemplate,
    };

    const markingRubricMap: Record<
      number,
      | string
      | { choices: Choice[] }
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
                "The marking rubric for text or URL-based questions, structured as an array of criterion objects",
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
        const response = await this.processPrompt(prompt);
        const parsedResponse = await parser.parse(response);

        // Handling TEXT and URL question types directly
        if (
          question.questionType === "TEXT" ||
          question.questionType === "URL"
        ) {
          markingRubricMap[question.id] = parsedResponse[0].rubric.map(
            (item: unknown) => ({
              id: (item as { id: number }).id ?? 0,
              description: (item as { description: string }).description ?? "",
              points: (item as { points: number }).points ?? 0,
            }),
          );
        }

        // Handling MULTIPLE_CORRECT and SINGLE_CORRECT question types
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

  // private methods
  private async processPrompt(prompt: PromptTemplate): Promise<string> {
    const input = await prompt.format({});

    // Get tokens for the input and compute token count
    const inputTokens = this.tiktokenEncoding.encode(input);
    this.logger.info(`Input token count: ${inputTokens.length}`);

    const response: string = (await this.llm.invoke(input)) as string;
    // Get tokens for the response and compute token count
    const responseTokens = this.tiktokenEncoding.encode(response);
    this.logger.info(`Output token count: ${responseTokens.length}`);

    return response;
  }
}
