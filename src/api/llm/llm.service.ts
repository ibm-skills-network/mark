import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { OpenAIModerationChain } from "langchain/chains";
import { OpenAI } from "langchain/llms/openai";
import { StructuredOutputParser } from "langchain/output_parsers";
import { PromptTemplate } from "langchain/prompts";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { z } from "zod";
import { TextBasedQuestionEvaluateModel } from "./model/text.based.question.evaluate.model";
import { TextBasedQuestionResponseModel } from "./model/text.based.question.response.model";

@Injectable()
export class LlmService {
  private readonly logger: Logger;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: LlmService.name });
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

  async gradeTextBasedQuestion(
    textBasedQuestionEvaluateModel: TextBasedQuestionEvaluateModel
  ): Promise<TextBasedQuestionResponseModel[]> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
    } = textBasedQuestionEvaluateModel;

    // Since question and scoring criteria are also validated with guard rails, only validate learnerResponse
    const validateLearnerResponse = await this.applyGuardRails(learnerResponse);
    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST
      );
    }

    const template = `As an experienced grader with over a decade of expertise, your task is to evaluate and grade an exercise following the provided guidelines.

    The exercise question is "{exercise_question}".\n The learner's response is "{learner_response}". 
    
    The exercise offers a maximum of {total_points} points, utilizes a scoring method of {scoring_type}, and follows the scoring criteria presented in the JSON format as follows: {scoring_criteria}. 
    
    Based on these parameters, assign points and provide constructive feedback:
    
    1. If the scoring type is "multiple_criteria", each criterion within the response should be evaluated independently. Award points for each criterion based on the learner's compliance with the expectations set for each point value within these criteria. If a criterion is not explicitly described for a specific point value (between the max and min points), use your AI capabilities to interpolate between the available descriptions to create a suitable criterion. Provide individualized feedback for each criterion that corresponds to the points allocated. This means each criterion should receive its own score and feedback.

    2. If the scoring type is "single_criteria", grade the response according to the expectations established for each point value in the scoring criteria. If a criterion is not explicitly provided for a specific point value (between the max and min points), use your AI capabilities to interpolate between the existing descriptions to create a suitable criterion. Assign points and feedback based on the learner's success in meeting the outlined expectations.
    
    3. If the scoring type is "ai_graded", apply your analytical capabilities to assess the response. From your assessment, allot a point value from the total possible points, which is {total_points}. Provide feedback based on the quality of the response and the points awarded.
    
    Please remember that your feedback should be constructive, designed to guide the learner in understanding their mistakes and learning from them. The ultimate objective is to support the learner in securing the maximum points on future attempts. Use a first person perespective as if you are speaking to the learner directly as a grader.
    
    {format_instructions}
    `;

    const parser = StructuredOutputParser.fromZodSchema(
      z
        .array(
          z.object({
            criteria: z
              .string()
              .describe("Criteria used for grading the response"),
            points: z.number().describe("Points awarded based on the criteria"),
            feedback: z
              .string()
              .describe(
                "Feedback for the learner based on their response to the criteria"
              ),
          })
        )
        .describe(
          "Array of grading data for each criterion or the question as a whole"
        )
    );

    const formatInstructions = parser.getFormatInstructions();
    console.log("formatInstructions", formatInstructions);

    const prompt = new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        exercise_question: question,
        learner_response: learnerResponse,
        total_points: totalPoints.toString(),
        scoring_type: scoringCriteriaType,
        scoring_criteria: JSON.stringify(scoringCriteria),
        format_instructions: formatInstructions,
      },
    });

    const llm = new OpenAI({ temperature: 0.5, modelName: "gpt-3.5-turbo" });
    const input = await prompt.format({});
    const response = await llm.call(input);
    console.log(response);

    const textBasedQuestionResponseModel = await parser.parse(response);
    console.log(textBasedQuestionResponseModel);

    return textBasedQuestionResponseModel;
  }
}
