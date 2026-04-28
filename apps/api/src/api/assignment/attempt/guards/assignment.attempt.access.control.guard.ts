import {
  CanActivate,
  ExecutionContext,
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
    const assignmentId = Number(assignmentIdString);

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

    if (attemptIdString) {
      const attemptId = Number(attemptIdString);
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

    if (questionIdString) {
      const questionId = Number(questionIdString);

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
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new NotFoundException("Assignment not found");
    }

    if (!assignmentGroup) {
      this.logger.warn("attempt_access_denied: no group link", {
        denial_reason: "no_group_link",
        assignment_id: assignmentId,
        user_id: userSession?.userId,
        group_id: userSession?.groupId,
        method,
        url: originalUrl,
      });
      return false;
    }

    if (attemptIdString && !attempt && userSession.role === UserRole.LEARNER) {
      this.logger.warn(
        "attempt_access_denied: attempt not found or not owned",
        {
          denial_reason: "attempt_not_found_or_unowned",
          assignment_id: assignmentId,
          attempt_id: Number(attemptIdString),
          user_id: userSession?.userId,
          role: userSession.role,
          method,
          url: originalUrl,
        },
      );
      throw new NotFoundException("Attempt not found or not owned by the user");
    }

    if (questionIdString && !questionInAssignment) {
      this.logger.warn("attempt_access_denied: question not in assignment", {
        denial_reason: "question_not_in_assignment",
        assignment_id: assignmentId,
        question_id: Number(questionIdString),
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new NotFoundException(
        "Question not found within the specified assignment",
      );
    }

    return true;
  }
}
