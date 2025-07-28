import { QuestionType } from "@prisma/client";
import { QuestionsToGenerate } from "../../../../assignment/dto/post.assignment.request.dto";
import {
  Choice,
  RubricDto,
  VariantDto,
} from "../../../../assignment/dto/update.questions.request.dto";
import { AssignmentTypeEnum } from "../services/question-generation.service";

export interface IQuestionGenerationService {
  /**
   * Generate assignment questions based on content and/or learning objectives
   */
  generateAssignmentQuestions(
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
  >;

  /**
   * Generate variations of a question
   */
  generateQuestionRewordings(
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
  >;

  /**
   * Generate contextual relationships between questions for grading
   */
  generateQuestionGradingContext(
    questions: { id: number; questionText: string }[],
    assignmentId: number,
  ): Promise<Record<number, number[]>>;
}
