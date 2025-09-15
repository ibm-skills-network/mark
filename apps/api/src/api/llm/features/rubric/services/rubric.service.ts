/* eslint-disable unicorn/no-null */
import { PromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  Criteria,
  ScoringType,
} from "src/api/assignment/question/dto/create.update.question.request.dto";
import { Logger } from "winston";
import { z } from "zod";
import {
  Choice,
  QuestionDto,
  RubricDto,
  ScoringDto,
} from "../../../../assignment/dto/update.questions.request.dto";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { PROMPT_PROCESSOR } from "../../../llm.constants";
import { IRubricService } from "../interfaces/rubric.interface";

@Injectable()
export class RubricService implements IRubricService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: RubricService.name });
  }

  /**
   * Create a marking rubric for a question
   */
  async createMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
  ): Promise<ScoringDto> {
    const rubricTemplate = this.selectRubricTemplate(question.type);

    if (!rubricTemplate) {
      return {
        type: ScoringType.CRITERIA_BASED,
        rubrics: [],
      };
    }
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        rubrics: z
          .array(
            z.object({
              rubricQuestion: z
                .string()
                .min(5)
                .describe(
                  "A question that evaluates a key aspect of the response",
                ),
              criteria: z
                .array(
                  z.object({
                    description: z
                      .string()
                      .min(10)
                      .describe("Detailed description of the criterion"),
                    points: z
                      .number()
                      .int()
                      .min(0)
                      .describe("Points awarded for this criterion"),
                  }),
                )
                .min(3)
                .max(5)
                .describe(
                  "List of criteria with DIFFERENT point values for evaluating this aspect, with higher points for better quality",
                ),
            }),
          )
          .min(2)
          .max(5)
          .describe("Array of rubric questions with their criteria"),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: `
        You are an expert educator creating a marking rubric for a {questionType} question.
    
        THE QUESTION:
        {question}
    
        RESPONSE TYPE: {responseType}
    
        INSTRUCTIONS:
        Create a comprehensive rubric with 3-4 distinct rubric questions...
        
        Use these focus areas as a guide:
        {rubricTemplate}
    
        IMPORTANT:
        - Each rubric question should focus on a single, clear aspect of evaluation...
        
        {formatInstructions}
      `,
      inputVariables: [],
      partialVariables: {
        rubricTemplate,
        formatInstructions,
        question: question.question,
        questionType: question.type,
        responseType: question.responseType || "OTHER",
      },
    });

    try {
      const response = await this.promptProcessor.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.QUESTION_GENERATION,
      );

      let parsed:
        | {
            rubrics?: {
              rubricQuestion?: string;
              criteria?: { description?: string; points?: number }[];
            }[];
          }
        | undefined;
      try {
        parsed = await parser.parse(response);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to parse JSON response: ${response}`);
        throw new Error(`Failed to parse JSON response: ${errorMessage}`);
      }

      if (
        !parsed ||
        !parsed.rubrics ||
        !Array.isArray(parsed.rubrics) ||
        parsed.rubrics.length === 0
      ) {
        this.logger.error("Response did not contain valid rubrics array");
        throw new Error("Response did not contain valid rubrics");
      }

      const validRubrics = parsed.rubrics.filter(
        (r) =>
          r &&
          r.rubricQuestion &&
          r.criteria &&
          Array.isArray(r.criteria) &&
          r.criteria.length >= 2 &&
          this.validateCriteria(r as RubricDto),
      );

      if (validRubrics.length === 0) {
        this.logger.error("No valid rubrics found in response");
        throw new Error("No valid rubrics found in response");
      }

      const finalScoring: ScoringDto = {
        type: ScoringType.CRITERIA_BASED,
        rubrics: (validRubrics as RubricDto[]).map((r) => ({
          rubricQuestion: r.rubricQuestion,
          criteria: r.criteria.map((c: Criteria) => ({
            description: c.description,
            points: c.points,
          })),
        })),
      };

      return finalScoring;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Error generating rubric: ${errorMessage || "Unknown error"}`,
      );

      return {
        type: ScoringType.CRITERIA_BASED,
        rubrics: [
          {
            rubricQuestion: "Content Accuracy",
            criteria: [
              {
                description: "Excellent - Comprehensive and accurate content",
                points: 3,
              },
              {
                description: "Good - Mostly accurate with minor omissions",
                points: 2,
              },
              {
                description:
                  "Needs Improvement - Several inaccuracies or major omissions",
                points: 1,
              },
            ],
          },
          {
            rubricQuestion: "Clarity and Organization",
            criteria: [
              {
                description: "Excellent - Well-organized and clearly expressed",
                points: 3,
              },
              {
                description:
                  "Good - Generally clear with minor organizational issues",
                points: 2,
              },
              {
                description: "Needs Improvement - Unclear or poorly organized",
                points: 1,
              },
            ],
          },
          {
            rubricQuestion: "Critical Thinking",
            criteria: [
              {
                description:
                  "Excellent - Insightful analysis and thoughtful reasoning",
                points: 3,
              },
              {
                description: "Good - Some analysis with adequate reasoning",
                points: 2,
              },
              {
                description:
                  "Needs Improvement - Minimal analysis or flawed reasoning",
                points: 1,
              },
            ],
          },
        ],
      };
    }
  }
  private validateCriteria(rubric: RubricDto): boolean {
    if (!rubric.criteria || rubric.criteria.length < 2) {
      return false;
    }

    const pointValues = new Set<number>();

    let previousPoints = Number.POSITIVE_INFINITY;

    for (const criterion of rubric.criteria) {
      if (!criterion.description || !criterion.description.trim()) {
        return false;
      }

      if (pointValues.has(criterion.points)) {
        return false;
      }
      pointValues.add(criterion.points);

      if (criterion.points > previousPoints) {
        return false;
      }
      previousPoints = criterion.points;
    }

    return true;
  }

  /**
   * Expand an existing marking rubric
   */
  async expandMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
  ): Promise<ScoringDto> {
    const rubricTemplate = this.selectRubricTemplate(question.type);

    if (!rubricTemplate) {
      return (
        question.scoring || {
          type: ScoringType.CRITERIA_BASED,
          rubrics: [],
        }
      );
    }

    const existingRubrics = question.scoring?.rubrics ?? [];

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        newRubrics: z
          .array(
            z.object({
              rubricQuestion: z
                .string()
                .min(5)
                .describe(
                  "A question that evaluates a key aspect of the response",
                ),
              criteria: z
                .array(
                  z.object({
                    description: z
                      .string()
                      .min(10)
                      .describe("Detailed description of the criterion"),
                    points: z
                      .number()
                      .int()
                      .min(0)
                      .describe("Points awarded for this criterion"),
                  }),
                )
                .min(2)
                .describe("List of criteria for evaluating this aspect"),
            }),
          )
          .min(1)
          .max(3)
          .describe("Array of new rubric questions with their criteria"),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: `
        You are an expert educator creating a marking rubric for a {questionType} question.
    
        THE QUESTION:
        {question}
    
        RESPONSE TYPE: {responseType}
    
        INSTRUCTIONS:
        Create a comprehensive rubric with 2-4 distinct rubric questions that evaluate different aspects of the response.
        
        For EACH rubric question:
        1. Create 3-5 criteria with DIFFERENT point values in DESCENDING order
        2. Each criterion should represent a SPECIFIC QUALITY LEVEL, not a checklist of features
        3. Higher points should be awarded for higher quality responses
        4. Points must be whole numbers and UNIQUE for each criterion (no duplicate point values)
        5. Descriptions should clearly explain what's expected for each point level
        
        Use these focus areas as a guide:
        {rubricTemplate}
    
        EXAMPLE OF PROPER CRITERIA STRUCTURE:
        For the question "How well is the content organized?":
        - 5 points: "Exceptional organization with clear sections, headings, and logical flow throughout."
        - 3 points: "Good organization with some structure but occasional inconsistencies in flow."
        - 1 point: "Basic organization with minimal structure and frequent issues with flow."
        
        IMPORTANT:
        - Ensure each criterion has a DIFFERENT point value
        - Point values must be in DESCENDING order (highest first)
        - Descriptions should clearly differentiate quality levels
        - Do not use terms like "full marks" or "partial marks"
        
        {formatInstructions}
      `,
      inputVariables: [],
      partialVariables: {
        rubricTemplate: () => rubricTemplate,
        formatInstructions: () => formatInstructions,
        question: () => question.question,
        questionType: () => question.type,
        responseType: () => question.responseType || "OTHER",
      },
    });

    try {
      const response = await this.promptProcessor.processPromptForFeature(
        prompt,
        assignmentId,
        AIUsageType.ASSIGNMENT_GRADING,
        "rubric_generation",
        "gpt-4o-mini",
      );
      let parsed:
        | {
            newRubrics?: {
              rubricQuestion?: string;
              criteria?: { description?: string; points?: number }[];
            }[];
          }
        | undefined;
      try {
        parsed = await parser.parse(response.trim());
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to parse JSON response: ${response}`);
        throw new Error(`Failed to parse JSON response: ${errorMessage}`);
      }

      if (
        !parsed ||
        !parsed.newRubrics ||
        !Array.isArray(parsed.newRubrics) ||
        parsed.newRubrics.length === 0
      ) {
        this.logger.error("Response did not contain valid new rubrics array");
        throw new Error("Response did not contain valid new rubrics");
      }

      const validNewRubrics = parsed.newRubrics.filter(
        (r) =>
          r &&
          r.rubricQuestion &&
          r.criteria &&
          Array.isArray(r.criteria) &&
          r.criteria.length >= 2,
      );

      if (validNewRubrics.length === 0) {
        this.logger.error("No valid new rubrics found in response");
        throw new Error("No valid new rubrics found in response");
      }

      const combinedRubrics = [...existingRubrics];
      const existingQuestions = new Set(
        existingRubrics.map((r) => r.rubricQuestion),
      );

      for (const newRubric of validNewRubrics) {
        if (!existingQuestions.has(newRubric.rubricQuestion)) {
          combinedRubrics.push({
            rubricQuestion: newRubric.rubricQuestion,
            criteria: newRubric.criteria.map((c) => ({
              description: c.description,
              points: c.points,
            })),
          });
        }
      }

      return {
        type: ScoringType.CRITERIA_BASED,
        rubrics: combinedRubrics,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Error expanding rubric: ${errorMessage || "Unknown error"}`,
      );
      return {
        type: ScoringType.CRITERIA_BASED,
        rubrics: existingRubrics,
      };
    }
  }

  /**
   * Create answer choices for a choice-based question
   */
  async createChoices(
    question: QuestionDto,
    assignmentId: number,
  ): Promise<Choice[]> {
    if (
      question.type !== "SINGLE_CORRECT" &&
      question.type !== "MULTIPLE_CORRECT"
    ) {
      return [];
    }

    const choiceTemplate =
      question.type === "SINGLE_CORRECT"
        ? this.getSingleChoiceTemplate()
        : this.getMultipleChoiceTemplate();

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        choices: z
          .array(
            z.object({
              choice: z.string().min(3).describe("Answer text"),
              id: z.number().int().min(1).describe("Unique identifier"),
              isCorrect: z.boolean().describe("Whether this choice is correct"),
              points: z
                .number()
                .int()
                .min(0)
                .describe("Points for this choice"),
              feedback: z
                .string()
                .optional()
                .describe("Feedback for this choice"),
            }),
          )
          .min(3)
          .max(6)
          .describe("Array of answer choices"),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: choiceTemplate,
      inputVariables: [],
      partialVariables: {
        question_json: JSON.stringify(question),
        format_instructions: formatInstructions,
      },
    });

    try {
      const response = await this.promptProcessor.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.QUESTION_GENERATION,
      );

      let parsed:
        | {
            choices?: {
              choice?: string;
              id?: number;
              isCorrect?: boolean;
              points?: number;
              feedback?: string;
            }[];
          }
        | undefined;
      try {
        parsed = await parser.parse(response.trim());
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to parse JSON response: ${response}`);
        throw new Error(`Failed to parse JSON response: ${errorMessage}`);
      }

      if (
        !parsed ||
        !parsed.choices ||
        !Array.isArray(parsed.choices) ||
        parsed.choices.length === 0
      ) {
        this.logger.error("Response did not contain valid choices array");
        throw new Error("Response did not contain valid choices");
      }

      const validChoices = parsed.choices.filter(
        (c) =>
          c &&
          typeof c.choice === "string" &&
          c.choice.trim() !== "" &&
          typeof c.isCorrect === "boolean" &&
          typeof c.points === "number",
      );

      if (validChoices.length === 0) {
        this.logger.error("No valid choices found in response");
        throw new Error("No valid choices found in response");
      }

      if (question.type === "SINGLE_CORRECT") {
        const correctChoices = validChoices.filter((c) => c.isCorrect);
        if (correctChoices.length !== 1) {
          const firstChoice = validChoices[0];
          for (const c of validChoices) c.isCorrect = false;
          firstChoice.isCorrect = true;
        }
      }

      if (
        question.type === "MULTIPLE_CORRECT" &&
        !validChoices.some((c) => c.isCorrect)
      ) {
        validChoices[0].isCorrect = true;
      }

      const finalChoices: Choice[] = validChoices.map((ch) => ({
        choice: ch.choice,
        isCorrect: ch.isCorrect,
        points: ch.points,
        feedback: ch.feedback || "",
      }));

      return finalChoices;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Error generating choices: ${errorMessage || "Unknown error"}`,
      );

      return question.type === "SINGLE_CORRECT"
        ? [
            {
              choice: "Option A",
              isCorrect: true,
              points: 1,
              feedback: "Correct option",
            },
            {
              choice: "Option B",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect option",
            },
            {
              choice: "Option C",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect option",
            },
            {
              choice: "Option D",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect option",
            },
          ]
        : [
            {
              choice: "Option A",
              isCorrect: true,
              points: 1,
              feedback: "Correct option",
            },
            {
              choice: "Option B",
              isCorrect: true,
              points: 1,
              feedback: "Correct option",
            },
            {
              choice: "Option C",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect option",
            },
            {
              choice: "Option D",
              isCorrect: false,
              points: 0,
              feedback: "Incorrect option",
            },
          ];
    }
  }

  /**
   * Check if a rubric is complete
   */
  isRubricComplete(rubric: RubricDto): boolean {
    if (!rubric.criteria || rubric.criteria.length < 2) {
      return false;
    }

    for (const c of rubric.criteria) {
      if (!c.description || !c.description.trim()) {
        return false;
      }
    }

    return true;
  }

  /**
   * Select the appropriate rubric template based on question type
   */
  private selectRubricTemplate(questionType: string): string {
    switch (questionType) {
      case "TEXT": {
        return this.getTextRubricTemplate();
      }
      case "URL": {
        return this.getUrlRubricTemplate();
      }
      case "UPLOAD":
      case "LINK_FILE": {
        return this.getFileRubricTemplate();
      }
      default: {
        return "";
      }
    }
  }

  private getTextRubricTemplate(): string {
    return `
    When creating a text-based question rubric, focus on these aspects:
    
    1. Content accuracy and completeness
       - How thoroughly and accurately does the response address the question?
       - Are key concepts correctly explained?
       - Are all parts of the question addressed?
    
    2. Critical thinking and analysis
       - Does the response demonstrate understanding beyond basic facts?
       - Is there evidence of thoughtful analysis?
       - Are connections made between concepts?
    
    3. Organization and structure
       - Is the response logically organized?
       - Are ideas presented in a coherent sequence?
       - Are transitions between ideas smooth?
    
    4. Evidence and examples
       - Are claims supported with relevant evidence?
       - Are examples appropriate and illustrative?
       - Is source material properly integrated?
    
    5. Writing quality and clarity
       - Is the writing clear and concise?
       - Is grammar and spelling generally correct?
       - Is vocabulary appropriate for the subject?
    `;
  }

  private getUrlRubricTemplate(): string {
    return `
    When creating a URL-based question rubric, focus on these aspects:
    
    1. URL relevance and quality
       - Is the URL directly relevant to the question?
       - Is the source credible and authoritative?
       - Is the content current and accurate?
    
    2. Content comprehensiveness
       - Does the linked content fully address the question?
       - Does it provide sufficient depth on the topic?
       - Does it cover all required aspects?
    
    3. Integration and explanation
       - Has the student explained why this URL is relevant?
       - Have they highlighted key points from the URL?
       - Have they connected the URL content to the question?
    
    4. Technical functionality
       - Does the URL work properly?
       - Does it load quickly and correctly?
       - Is it accessible without special permissions?
    
    5. Critical evaluation
       - Has the student evaluated the credibility of the source?
       - Have they noted any potential biases or limitations?
       - Have they compared this source with others when appropriate?
    `;
  }

  private getFileRubricTemplate(): string {
    return `
    When creating a file upload question rubric, focus on these aspects:
    
    1. Content accuracy and relevance
       - Does the file content directly address the question?
       - Is the information accurate and current?
       - Are all required elements included?
    
    2. Organization and structure
       - Is the file well-organized and easy to navigate?
       - Are sections clearly labeled and logical?
       - Does the structure enhance understanding?
    
    3. Technical quality
       - Is the file formatted correctly?
       - Is it free of technical errors?
       - Does it meet all specified requirements?
    
    4. Creativity and originality
       - Does the submission show original thinking?
       - Are ideas presented in a unique or innovative way?
       - Does it go beyond basic requirements?
    
    5. Presentation and professionalism
       - Is the file visually appealing and well-designed?
       - Is formatting consistent and appropriate?
       - Does it reflect professional standards for this type of work?
    `;
  }

  private getSingleChoiceTemplate(): string {
    return `
    You are creating answer choices for a single-correct multiple-choice question.
    
    QUESTION:
    {question_json}
    
    INSTRUCTIONS:
    1. Create 4-5 distinct answer choices that align with the question.
    2. Designate exactly ONE choice as correct.
    3. Ensure incorrect choices are plausible but clearly wrong.
    4. Avoid choices that are partially correct or "all/none of the above".
    5. Provide brief feedback for each choice explaining why it is correct or incorrect.
    6. Assign appropriate point values (typically the correct answer gets full points).
    
    {format_instructions}
    `;
  }

  private getMultipleChoiceTemplate(): string {
    return `
    You are creating answer choices for a multiple-correct multiple-choice question.
    
    QUESTION:
    {question_json}
    
    INSTRUCTIONS:
    1. Create 4-6 distinct answer choices that align with the question.
    2. Designate at least TWO choices as correct.
    3. Ensure incorrect choices are plausible but clearly wrong.
    4. Avoid choices that are partially correct (each should be entirely correct or incorrect).
    5. Provide brief feedback for each choice explaining why it is correct or incorrect.
    6. Assign appropriate point values to each choice.
    
    {format_instructions}
    `;
  }
}
