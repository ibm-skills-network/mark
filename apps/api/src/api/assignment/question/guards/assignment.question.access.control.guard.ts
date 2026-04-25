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
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { Logger } from "winston";
import { PrismaService } from "../../../../database/prisma.service";

@Injectable()
export class AssignmentQuestionAccessControlGuard implements CanActivate {
  private readonly logger: Logger;

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: AssignmentQuestionAccessControlGuard.name,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params, method, originalUrl } = request;
    const { assignmentId: assignmentIdString, id } = params;
    const assignmentId = Number(assignmentIdString);
    if (!assignmentId || Number.isNaN(assignmentId)) {
      this.logger.warn("question_access_denied: invalid assignment id", {
        denial_reason: "invalid_assignment_id",
        param_assignmentId: assignmentIdString,
        param_id: id,
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new ForbiddenException("Invalid assignment ID");
    }

    const questionId = id ? Number(id) : undefined;
    if (
      id !== undefined &&
      (questionId === undefined || Number.isNaN(questionId))
    ) {
      this.logger.warn("question_access_denied: invalid question id", {
        denial_reason: "invalid_question_id",
        param_assignmentId: assignmentIdString,
        param_id: id,
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new ForbiddenException("Invalid question ID");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queries: any[] = [
      this.prisma.assignment.findUnique({ where: { id: assignmentId } }),

      this.prisma.assignmentGroup.findFirst({
        where: {
          assignmentId,
          groupId: userSession.groupId,
        },
      }),
    ];

    if (questionId) {
      queries.push(
        this.prisma.question.findFirst({
          where: {
            id: questionId,
            assignmentId,
          },
        }),
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [assignment, assignmentGroup, questionInAssignment] =
      await this.prisma.$transaction(queries);

    if (!assignment) {
      this.logger.warn("question_access_denied: assignment not found", {
        denial_reason: "assignment_not_found",
        assignment_id: assignmentId,
        question_id: questionId,
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new NotFoundException("Assignment not found");
    }

    if (!assignmentGroup) {
      this.logger.warn("question_access_denied: no group link", {
        denial_reason: "no_group_link",
        assignment_id: assignmentId,
        question_id: questionId,
        user_id: userSession?.userId,
        group_id: userSession?.groupId,
        method,
        url: originalUrl,
      });
      return false;
    }

    if (questionId && !questionInAssignment) {
      this.logger.warn("question_access_denied: question not in assignment", {
        denial_reason: "question_not_in_assignment",
        assignment_id: assignmentId,
        question_id: questionId,
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
