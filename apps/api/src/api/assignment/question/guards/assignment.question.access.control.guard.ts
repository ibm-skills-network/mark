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

    const assignmentId = parsePositiveIntId(assignmentIdString);
    if (assignmentId === undefined) {
      this.logger.warn("question_access_denied: invalid assignment id", {
        denial_reason: "invalid_assignment_id",
        param_assignmentId: sanitizeForLog(assignmentIdString),
        param_id: sanitizeForLog(id),
        user_id: sanitizeForLog(userSession?.userId),
        method,
        url: sanitizeForLog(originalUrl),
      });
      throw new ForbiddenException("Invalid assignment ID");
    }

    let questionId: number | undefined;
    if (id !== undefined) {
      questionId = parsePositiveIntId(id);
      if (questionId === undefined) {
        this.logger.warn("question_access_denied: invalid question id", {
          denial_reason: "invalid_question_id",
          param_assignmentId: sanitizeForLog(assignmentIdString),
          param_id: sanitizeForLog(id),
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
          assignmentId,
          groupId: userSession.groupId,
        },
      }),
    ];

    if (questionId !== undefined) {
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
        user_id: sanitizeForLog(userSession?.userId),
        method,
        url: sanitizeForLog(originalUrl),
      });
      throw new NotFoundException("Assignment not found");
    }

    if (!assignmentGroup) {
      this.logger.warn("question_access_denied: no group link", {
        denial_reason: "no_group_link",
        assignment_id: assignmentId,
        question_id: questionId,
        user_id: sanitizeForLog(userSession?.userId),
        group_id: sanitizeForLog(userSession?.groupId),
        method,
        url: sanitizeForLog(originalUrl),
      });
      return false;
    }

    if (questionId !== undefined && !questionInAssignment) {
      this.logger.warn("question_access_denied: question not in assignment", {
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
