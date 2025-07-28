import { Injectable } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";
import { AssignmentTypeEnum } from "./question-generation.service";

/**
 * Service for managing question generation templates
 */
@Injectable()
export class QuestionTemplateService {
  /**
   * Get the appropriate schema parser for question rewording based on question type
   */
  getQuestionRewordingSchema(
    questionType: QuestionType,
    variationCount: number,
  ): StructuredOutputParser<any> {
    const baseQuestionSchema = z.object({
      id: z.number().describe("Unique identifier for the variation"),
      variantContent: z
        .string()
        .describe("A reworded variation of the question text"),
    });

    const trueFalseQuestionItemSchema = baseQuestionSchema.extend({
      type: z.literal("TRUE_FALSE"),
      choices: z
        .array(
          z.object({
            choice: z.enum(["True", "False"]),
            points: z.number().min(1),
            feedback: z.string().optional(),
            isCorrect: z.boolean(),
          }),
        )
        .length(2),
    });

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
        .min(2),
    });

    const singleCorrectQuestionItemSchema = baseQuestionSchema.extend({
      type: z.literal("SINGLE_CORRECT"),
      choices: z.array(
        z.object({
          choice: z.string(),
          points: z.number().min(0),
          feedback: z.string().optional(),
          isCorrect: z.boolean(),
        }),
      ),
    });

    switch (questionType) {
      case QuestionType.TRUE_FALSE: {
        return StructuredOutputParser.fromZodSchema(
          z.array(trueFalseQuestionItemSchema).min(1).max(variationCount),
        );
      }
      case QuestionType.MULTIPLE_CORRECT: {
        return StructuredOutputParser.fromZodSchema(
          z.array(multipleCorrectQuestionItemSchema).min(1).max(variationCount),
        );
      }
      case QuestionType.SINGLE_CORRECT: {
        return StructuredOutputParser.fromZodSchema(
          z.array(singleCorrectQuestionItemSchema).min(1).max(variationCount),
        );
      }
      case QuestionType.TEXT:
      case QuestionType.UPLOAD:
      case QuestionType.LINK_FILE:
      case QuestionType.URL: {
        return StructuredOutputParser.fromZodSchema(
          z.array(baseQuestionSchema).min(1).max(variationCount),
        );
      }
      default: {
        return StructuredOutputParser.fromZodSchema(
          z.array(baseQuestionSchema).min(1).max(variationCount),
        );
      }
    }
  }

  /**
   * Select the appropriate template name based on available inputs
   */
  selectQuestionGenerationTemplate(
    content?: string,
    learningObjectives?: string,
  ): string {
    if (content && learningObjectives) {
      return "generateAssignmentQuestionsFromFileAndObjectivesTemplate";
    } else if (content) {
      return "generateAssignmentQuestionsFromFileTemplate";
    } else {
      return "generateAssignmentQuestionsFromObjectivesTemplate";
    }
  }

  /**
   * Select the appropriate rewording template based on question type
   */
  selectQuestionRewordingTemplate(questionType: QuestionType): string {
    if (
      questionType === QuestionType.MULTIPLE_CORRECT ||
      questionType === QuestionType.SINGLE_CORRECT
    ) {
      return "generateQuestionWithChoicesRewordingsTemplate";
    } else if (questionType === QuestionType.TRUE_FALSE) {
      return "generateQuestionWithTrueFalseRewordingsTemplate";
    } else {
      return "generateQuestionRewordingsTemplate";
    }
  }

  /**
   * Get difficulty description for an assignment type
   */
  getDifficultyDescription(difficulty: AssignmentTypeEnum): string {
    switch (difficulty) {
      case AssignmentTypeEnum.PRACTICE: {
        return "Surface-level, simple questions to reinforce understanding.";
      }
      case AssignmentTypeEnum.QUIZ: {
        return "Moderately challenging questions to test comprehension.";
      }
      case AssignmentTypeEnum.ASSESSMENT: {
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
  }

  /**
   * Get the grading context template
   */
  getGradingContextTemplate(): string {
    return `
    As an expert grader, your role is critical and requires a keen sense of observation. The goal is to identify the interconnectedness between a sequence of questions based on their content and potential answers. 

    Consider these scenarios for clarity:
    1. If a question asks for a URL and subsequent questions pertain to the content of that URL, there's a direct dependency.
    2. A question might ask about an opinion or a fact. The answer given, whether in textual format, multiple-choice selection, or true/false, could be pivotal for understanding the context of following questions.
    3. If a question seeks an explanation about a term or concept, and later questions delve deeper into that topic, the earlier question sets the stage.

    Using these examples as a reference point:

    {questions_json_array}

    Delve into each question and ascertain if it leans on any of the previous questions either due to the content of the question itself or potential answers that might be provided. Document these dependencies, creating a blueprint vital for the grading process. Don't provide any explanation just follow the format instructions below for the output.

    {format_instructions}
    `;
  }

  /**
   * Get question generation template based on template name
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getQuestionGenerationTemplate(templateName: string): Promise<string> {
    const templates: Record<string, string> = {
      generateAssignmentQuestionsFromFileTemplate: `
      You are an expert teacher tasked with creating a set of questions based on the provided content.
      Content: {content}
      
      Guidelines:
       Generate exactly {totalQuestionsToGenerate} of questions based on the distribution specified below. No more, no less:
        - MULTIPLE_CHOICE: {multipleChoice} questions.
        - MULTIPLE_SELECT: {multipleSelect} questions.
        - TEXT_RESPONSE: {textResponse} questions.
        - TRUE_FALSE: {trueFalse} questions.
      - Questions should align with the following difficulty type: {difficultyDescription}.
      - Ensure each question covers the entire scope of the content.
      - For MULTIPLE_CHOICE/SINGLE_CHOICE questions (if any), include defined feedback for each choice. Make at least 4 choices for each question.
      - For TRUE_FALSE questions (if any):
        - Only provide one choice as "true" with \`isCorrect\` set to \`true\` and \`points: 1\`.
        - Do **not** generate multiple choices for TRUE/FALSE questions.
      - For TEXT_RESPONSE questions (if any):
        - Provide a scoring rubric with clear criteria.
        - Criteria should have unique points and a concise description.
        - Points must be in descending order, with clear distinctions between levels.
        - Generate enough rubric criteria to cover the entire scope of the learning objectives.
      - Avoid unnecessary tokens; keep descriptions short and concise.
      Output format:
      {format_instructions}
      `,
      generateAssignmentQuestionsFromObjectivesTemplate: `
      You are an expert teacher tasked with creating a set of questions based on the provided learning objectives.
      Learning Objectives: {learning_objectives}
      
      Guidelines:
       Generate exactly {totalQuestionsToGenerate} of questions based on the distribution specified below. No more, no less:
        - MULTIPLE_CHOICE: {multipleChoice} questions.
        - MULTIPLE_SELECT: {multipleSelect} questions.
        - TEXT_RESPONSE: {textResponse} questions.
        - TRUE_FALSE: {trueFalse} questions.
      - Questions should align with the following difficulty type: {difficultyDescription}.
      - Ensure each question covers key elements of the learning objectives. Do not deviate from the objectives and maintain a clear focus with no redundancy.
      - For MULTIPLE_CHOICE/SINGLE_CHOICE questions (if any), include defined feedback for each choice. Make at least 4 choices for each question.
      - For TRUE_FALSE questions (if any):
        - Only provide one choice as "true" with \`isCorrect\` set to \`true\` and \`points: 1\`.
        - Do **not** generate multiple choices for TRUE/FALSE questions.
      - For TEXT_RESPONSE questions (if any):
        - Provide a scoring rubric with clear criteria.
        - Criteria should have unique points and a concise description.
        - Points must be in descending order, with clear distinctions between levels.
        - Generate enough rubric criteria to cover the entire scope of the learning objectives.
      - Avoid unnecessary tokens; keep descriptions short and concise.
      Output format:
      {format_instructions}
      `,
      generateAssignmentQuestionsFromFileAndObjectivesTemplate: `
      You are an expert teacher tasked with creating a set of questions based on the provided learning objectives and content.
      Content: {content}
      Learning Objectives: {learning_objectives}
      
      Guidelines:
      - Generate exactly {totalQuestionsToGenerate} of questions based on the distribution specified below. No more, no less:
        - MULTIPLE_CHOICE: {multipleChoice} questions.
        - MULTIPLE_SELECT: {multipleSelect} questions.
        - TEXT_RESPONSE: {textResponse} questions.
        - TRUE_FALSE: {trueFalse} questions.
      - Questions should align with the following difficulty type: {difficultyDescription}.
      - Ensure each question covers key elements of the learning objectives. Do not deviate from the objectives and maintain a clear focus with no redundancy.
      - For MULTIPLE_CHOICE/SINGLE_CHOICE questions (if any), include defined feedback for each choice. Make at least 4 choices for each question.
      - For TRUE_FALSE questions (if any):
        - Only provide one choice as "true" with \`isCorrect\` set to \`true\` and \`points: 1\`.
        - Do **not** generate multiple choices for TRUE/FALSE questions.
      - For TEXT_RESPONSE questions (if any):
        - Provide a scoring rubric with clear criteria.
        - Criteria should have unique points and a concise description.
        - Points must be in descending order, with clear distinctions between levels.
        - Generate enough rubric criteria to cover the entire scope of the learning objectives.
      - Avoid unnecessary tokens; keep descriptions short and concise.
      Output format:
      {format_instructions}
      `,
    };

    return (
      templates[templateName] ??
      templates["generateAssignmentQuestionsFromFileTemplate"]
    );
  }

  /**
   * Get question rewording template based on template name
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getQuestionRewordingTemplate(templateName: string): Promise<string> {
    const templates: Record<string, string> = {
      generateQuestionRewordingsTemplate: `
      Generate {variation_count} creative variants of the following question:
      Question: {question_text}
      Existing variants: {variants}
      
      Your goal:
      - Create distinct versions of the question that can replace the original, maintaining the same intent, meaning, and context.
      - Change the question structure, focus, or angle while staying within the same topic and purpose.
      - Avoid simple paraphrasing; instead, introduce subtle contextual or structural changes to make the question feel new and engaging.
      
      Additional Notes:
      - Keep the level of difficulty and intent consistent with the original question.
      - Variants should be creative, thoughtful, and test the same knowledge or skill as the original.
      - Avoid introducing unrelated ideas or deviating from the original intent.
      
      {format_instructions}
      Return your answer **as a JSON array** with {variation_count} objects
      `,
      generateQuestionWithChoicesRewordingsTemplate: `
      Generate {variation_count} creative variants of the following question and its associated choices:
      Question: {question_text}
      Choices: {choices_text}
      Existing variants: {variants}
      
      Your goal:
      - Create distinct versions of the question and its choices, ensuring they remain relevant, meaningful, and aligned with the original intent.
      - Change the question focus, structure, or context to make it feel fresh, while still testing the same concept or knowledge.
      - Generate alternative choices where possible, replacing distractors (incorrect options) with new, plausible alternatives that fit the new question phrasing or context.
      - Provide meaningful feedback for each choice in choice-based questions, ensuring they align with the reworded question.
      
      Additional Notes:
      - Correct answers should remain accurate but can be reworded or framed differently to align with the new question.
      - Distractors should be realistic, thoughtfully created, and align with the topic, while differing slightly from the original distractors.
      - Avoid trivial rephrasing; aim for medium-difference variations that are distinct but interchangeable with the original.
      {format_instructions}
      Return your answer **as a JSON array** with {variation_count} objects
      `,
      generateQuestionWithTrueFalseRewordingsTemplate: `
      Generate {variation_count} creative variants of the following true/false question:
      Question: {question_text}
      Existing variants: {variants}
      
      Goals:
      - Maintain the same core concept or context while presenting fresh and engaging variations.
      - Include both **true** and **false** statements, aiming for a balanced mix.
      - For **false** statements, use plausible but incorrect alternatives.
      
      Guidelines:
      - Avoid trivial changes (e.g., simple negations or word swaps).
      - Ensure factual accuracy for **true** statements and clear incorrectness for **false** ones.
      - Keep the phrasing clear and concise.
      
      {format_instructions}
      Return your answer **as a JSON array** with {variation_count} objects
      `,
    };

    return (
      templates[templateName] ?? templates["generateQuestionRewordingsTemplate"]
    );
  }
}
