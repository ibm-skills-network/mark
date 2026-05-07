import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../database/prisma.service";
import { sanitizeForLog } from "../../../../logger/sanitize";

// Strict positive-integer parser. Rejects NaN, decimals (`"1.5"`),
// exponent form (`"1e3"`), hex (`"0x1"`), whitespace, leading `+`, and
// leading zeros — anything that `Number()` would coerce but that is
// not a clean canonical positive integer string.
const parsePositiveIntId = (raw: string | undefined): number | undefined => {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  if (String(n) !== raw) return undefined;
  return n;
};

@Injectable()
export class AssignmentAttemptAccessControlGuard implements CanActivate {
  private readonly logger: Logger;

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: AssignmentAttemptAccessControlGuard.name,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params, method, originalUrl } = request;
    const {
      assignmentId: assignmentIdString,
      attemptId: attemptIdString,
      questionId: questionIdString,
    } = params;

    const assignmentId = parsePositiveIntId(assignmentIdString);
    if (assignmentId === undefined) {
      this.logger.warn("attempt_access_denied: invalid assignment id", {
        denial_reason: "invalid_assignment_id",
        param_assignmentId: sanitizeForLog(assignmentIdString),
        param_attemptId: sanitizeForLog(attemptIdString),
        param_questionId: sanitizeForLog(questionIdString),
        user_id: sanitizeForLog(userSession?.userId),
        method,
        url: sanitizeForLog(originalUrl),
      });
      throw new ForbiddenException("Invalid assignment ID");
    }

    let attemptId: number | undefined;
    if (attemptIdString !== undefined) {
      attemptId = parsePositiveIntId(attemptIdString);
      if (attemptId === undefined) {
        this.logger.warn("attempt_access_denied: invalid attempt id", {
          denial_reason: "invalid_attempt_id",
          param_assignmentId: sanitizeForLog(assignmentIdString),
          param_attemptId: sanitizeForLog(attemptIdString),
          user_id: sanitizeForLog(userSession?.userId),
          method,
          url: sanitizeForLog(originalUrl),
        });
        throw new ForbiddenException("Invalid attempt ID");
      }
    }

    let questionId: number | undefined;
    if (questionIdString !== undefined) {
      questionId = parsePositiveIntId(questionIdString);
      if (questionId === undefined) {
        this.logger.warn("attempt_access_denied: invalid question id", {
          denial_reason: "invalid_question_id",
          param_assignmentId: sanitizeForLog(assignmentIdString),
          param_questionId: sanitizeForLog(questionIdString),
          user_id: sanitizeForLog(userSession?.userId),
          method,
          url: sanitizeForLog(originalUrl),
        });
        throw new ForbiddenException("Invalid question ID");
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queries: any[] = [
      this.prisma.assignment.findUnique({ where: { id: assignmentId } }),

      this.prisma.assignmentGroup.findFirst({
        where: {
          assignmentId: assignmentId,
          groupId: userSession.groupId,
        },
      }),
    ];

    if (attemptId !== undefined) {
      const whereClause: {
        id: number;
        assignmentId: number;
        userId?: string;
      } = {
        id: attemptId,
        assignmentId: assignmentId,
      };

      if (userSession.role === UserRole.LEARNER) {
        whereClause.userId = userSession.userId;
      }

      queries.push(
        this.prisma.assignmentAttempt.findFirst({ where: whereClause }),
      );
    }

    if (questionId !== undefined) {
      queries.push(
        this.prisma.question.findFirst({
          where: {
            id: questionId,
            assignmentId: assignmentId,
          },
        }),
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [assignment, assignmentGroup, attempt, questionInAssignment] =
      await this.prisma.$transaction(queries);

    if (!assignment) {
      this.logger.warn("attempt_access_denied: assignment not found", {
        denial_reason: "assignment_not_found",
        assignment_id: assignmentId,
        user_id: sanitizeForLog(userSession?.userId),
        method,
        url: sanitizeForLog(originalUrl),
      });
      throw new NotFoundException("Assignment not found");
    }

    if (!assignmentGroup) {
      this.logger.warn("attempt_access_denied: no group link", {
        denial_reason: "no_group_link",
        assignment_id: assignmentId,
        user_id: sanitizeForLog(userSession?.userId),
        group_id: sanitizeForLog(userSession?.groupId),
        method,
        url: sanitizeForLog(originalUrl),
      });
      return false;
    }

    if (
      attemptId !== undefined &&
      !attempt &&
      userSession.role === UserRole.LEARNER
    ) {
      this.logger.warn(
        "attempt_access_denied: attempt not found or not owned",
        {
          denial_reason: "attempt_not_found_or_unowned",
          assignment_id: assignmentId,
          attempt_id: attemptId,
          user_id: sanitizeForLog(userSession?.userId),
          role: userSession.role,
          method,
          url: sanitizeForLog(originalUrl),
        },
      );
      throw new NotFoundException("Attempt not found or not owned by the user");
    }

    if (questionId !== undefined && !questionInAssignment) {
      this.logger.warn("attempt_access_denied: question not in assignment", {
        denial_reason: "question_not_in_assignment",
        assignment_id: assignmentId,
        question_id: questionId,
        user_id: sanitizeForLog(userSession?.userId),
        method,
        url: sanitizeForLog(originalUrl),
      });
      throw new NotFoundException(
        "Question not found within the specified assignment",
      );
    }

    return true;
  }
}
