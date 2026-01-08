import { Prisma } from "@prisma/client";
import { QuestionAnswerContext } from "src/api/llm/model/base.question.evaluate.model";
import { PrismaService } from "src/database/prisma.service";

type PrismaTransactionalClient = Omit<
  PrismaService,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use"
>;
/**
 * Context data needed for grading a question response
 */
export interface GradingContext {
  /**
   * Instructions for the entire assignment
   */
  assignmentInstructions: string;

  /**
   * Context from other questions and answers
   */
  questionAnswerContext: QuestionAnswerContext[];

  /**
   * ID of the assignment
   */
  assignmentId?: number;

  /**
   * Language code for localization
   */
  language?: string;

  /**
   * Optional user role
   */
  userRole?: string;

  /**
   * Optional metadata for grading
   */
  metadata?: Record<string, any>;

  /**
   * Optional Prisma transactional client
   */
  tx?: PrismaTransactionalClient;
}
