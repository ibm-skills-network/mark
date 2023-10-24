import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { OpenAIModerationChain } from "langchain/chains";
import { BaseLLM } from "langchain/dist/llms/base";
import { OpenAI } from "langchain/llms/openai";
import { StructuredOutputParser } from "langchain/output_parsers";
import { PromptTemplate } from "langchain/prompts";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { z } from "zod";
import { ChoiceBasedQuestionEvaluateModel } from "./model/choice.based.question.evaluate.model";
import {
  ChoiceBasedFeedback,
  ChoiceBasedQuestionResponseModel,
} from "./model/choice.based.question.response.model";
import { TextBasedQuestionEvaluateModel } from "./model/text.based.question.evaluate.model";
import { TextBasedQuestionResponseModel } from "./model/text.based.question.response.model";
import { TrueFalseBasedQuestionEvaluateModel } from "./model/true.false.based.question.evaluate.model";
import { TrueFalseBasedQuestionResponseModel } from "./model/true.false.based.question.response.model";
import { UrlBasedQuestionEvaluateModel } from "./model/url.based.question.evaluate.model";
import { UrlBasedQuestionResponseModel } from "./model/url.based.question.response.model";
import {
  feedbackChoiceBasedQuestionLlmTemplate,
  feedbackTrueFalseBasedQuestionLlmTemplate,
  generateQuestionsGradingContext,
  gradeTextBasedQuestionLlmTemplate,
  gradeUrlBasedQuestionLlmTemplate,
} from "./templates";

@Injectable()
export class LlmService {
  private readonly logger: Logger;
  private llmGpt3: BaseLLM;
  private llmGpt4: BaseLLM;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: LlmService.name });
    this.llmGpt3 = new OpenAI({ temperature: 0.5, modelName: "gpt-3.5-turbo" });
    this.llmGpt4 = new OpenAI({ temperature: 0.5, modelName: "gpt-4" });
  }

  async applyGuardRails(message: string): Promise<boolean> {
    const moderation = new OpenAIModerationChain();

    const { output: guardRailsResponse } = await moderation.call({
      input: message,
    });

    return (
      guardRailsResponse !==
      "Text was found that violates OpenAI's content policy."
    );
  }

  async generateQuestionGradingContext(
    questions: { id: number; questionText: string }[]
  ): Promise<Record<number, number[]>> {
    const parser = StructuredOutputParser.fromZodSchema(
      z.array(
        z
          .object({
            questionId: z.number().describe("The id of the question"),
            contextQuestions: z
              .array(z.number())
              .describe(
                "The ids of all the questions that this question depends upon contextually"
              ),
          })
          .describe(
            "Array of objects, where each object represents a question and its contextual dependencies."
          )
      )
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

    const input = await prompt.format({});
    const response = await this.llmGpt4.call(input);
    const parsedResponse = await parser.parse(response);
    const gradingContextQuestionMap: Record<number, number[]> = {};
    for (const item of parsedResponse) {
      gradingContextQuestionMap[item.questionId] = item.contextQuestions;
    }
    return gradingContextQuestionMap;
  }

  async gradeTrueFalseBasedQuestion(
    trueFalseBasedQuestionEvaluateModel: TrueFalseBasedQuestionEvaluateModel
  ): Promise<TrueFalseBasedQuestionResponseModel> {
    const { question, answer, learnerChoice, totalPoints } =
      trueFalseBasedQuestionEvaluateModel;

    let pointsEarned = 0;

    if (learnerChoice === answer) {
      pointsEarned = totalPoints;
    }

    const parser = StructuredOutputParser.fromZodSchema(
      z
        .object({
          choice: z
            .boolean()
            .describe(
              "The choice selected by the learner (can be either true or false)"
            ),
          feedback: z
            .string()
            .describe("Feedback provided for the learner's choice"),
        })
        .describe("Feedback for the choice made by the learner")
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: feedbackTrueFalseBasedQuestionLlmTemplate,
      inputVariables: [],
      partialVariables: {
        question: question,
        learner_choice: JSON.stringify(learnerChoice),
        answer: JSON.stringify(answer),
        format_instructions: formatInstructions,
      },
    });

    const input = await prompt.format({});
    const response = await this.llmGpt3.call(input);

    const trueFalseBasedQuestionResponseModel = (await parser.parse(
      response
    )) as TrueFalseBasedQuestionResponseModel;

    return trueFalseBasedQuestionResponseModel;
  }

  async gradeChoiceBasedQuestion(
    choiceBasedQuestionEvaluateModel: ChoiceBasedQuestionEvaluateModel
  ): Promise<ChoiceBasedQuestionResponseModel> {
    // TODO: Handle loss per mistake

    const {
      question,
      learnerChoices,
      validChoices,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
    } = choiceBasedQuestionEvaluateModel;

    // Initialize score count
    let pointsEarned = 0;

    for (const choice of learnerChoices) {
      // If the learner's choice is correct, increment the score count
      if (validChoices[choice] === true) {
        pointsEarned++;
      }
    }

    const parser = StructuredOutputParser.fromZodSchema(
      z.array(
        z
          .object({
            choice: z.string().describe("The choice selected by the learner"),
            feedback: z
              .string()
              .describe("Feedback provided for the learner's choice"),
          })
          .describe("Feedback for each choice made by the learner")
      )
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: feedbackChoiceBasedQuestionLlmTemplate,
      inputVariables: [],
      partialVariables: {
        question: question,
        assignment_instructions: assignmentInstrctions,
        previous_questions_and_answers: JSON.stringify(
          previousQuestionsAnswersContext
        ),
        learner_choices: JSON.stringify(learnerChoices),
        valid_choices: JSON.stringify(validChoices),
        format_instructions: formatInstructions,
      },
    });

    const input = await prompt.format({});
    const response = await this.llmGpt3.call(input);

    const choiceBasedFeedback = (await parser.parse(
      response
    )) as ChoiceBasedFeedback[];

    return new ChoiceBasedQuestionResponseModel(
      pointsEarned,
      choiceBasedFeedback
    );
  }

  async gradeTextBasedQuestion(
    textBasedQuestionEvaluateModel: TextBasedQuestionEvaluateModel
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
        HttpStatus.BAD_REQUEST
      );
    }

    const parser = StructuredOutputParser.fromZodSchema(
      z
        .object({
          points: z.number().describe("Points awarded based on the criteria"),
          feedback: z
            .string()
            .describe(
              "Feedback for the learner based on their response to the criteria"
            ),
        })
        .describe("Object representing points and feedback")
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: gradeTextBasedQuestionLlmTemplate,
      inputVariables: [],
      partialVariables: {
        question: question,
        assignment_instructions: assignmentInstrctions,
        previous_questions_and_answers: JSON.stringify(
          previousQuestionsAnswersContext
        ),
        learner_response: learnerResponse,
        total_points: totalPoints.toString(),
        scoring_type: scoringCriteriaType,
        scoring_criteria: JSON.stringify(scoringCriteria),
        format_instructions: formatInstructions,
      },
    });

    const input = await prompt.format({});
    const response = await this.llmGpt3.call(input);

    const textBasedQuestionResponseModel = (await parser.parse(
      response
    )) as TextBasedQuestionResponseModel;

    return textBasedQuestionResponseModel;
  }

  async gradeUrlBasedQuestion(
    urlBasedQuestionEvaluateModel: UrlBasedQuestionEvaluateModel
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
        HttpStatus.BAD_REQUEST
      );
    }

    const parser = StructuredOutputParser.fromZodSchema(
      z
        .object({
          points: z.number().describe("Points awarded based on the criteria"),
          feedback: z
            .string()
            .describe(
              "Feedback for the learner based on their response to the criteria"
            ),
        })
        .describe("Object representing points and feedback")
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: gradeUrlBasedQuestionLlmTemplate,
      inputVariables: [],
      partialVariables: {
        question: question,
        assignment_instructions: assignmentInstrctions,
        previous_questions_and_answers: JSON.stringify(
          previousQuestionsAnswersContext
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

    const input = await prompt.format({});
    const response = await this.llmGpt3.call(input);

    const urlBasedQuestionResponseModel = (await parser.parse(
      response
    )) as UrlBasedQuestionResponseModel;

    return urlBasedQuestionResponseModel;
  }
}
