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

// Verbs that can only reach a read handler. A write always re-enters the guard
// under its own verb, so this cannot be widened by a crafted request.
const READ_ONLY_METHODS = new Set(["GET", "HEAD"]);

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

const readNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * Owner of an attempt row returned by the transaction. The rows come back from
 * a loosely typed `$transaction` array, so the owner is read defensively: an
 * absent or non-string `userId` yields `undefined` and therefore matches no
 * session.
 */
const readAttemptOwnerId = (attempt: unknown): string | undefined => {
  if (typeof attempt !== "object" || attempt === null) return undefined;
  return readNonEmptyString((attempt as { userId?: unknown }).userId);
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

    // The user id an attempt must carry for this session to read it. A learner
    // reaches an attempt row only through this value, so a session that does
    // not supply one has to stop the request rather than fall through: Prisma
    // reads `undefined` in a `where` as "no filter supplied", which would turn
    // the ownership query into a lookup matching any learner's attempt.
    const learnerUserId =
      userSession?.role === UserRole.LEARNER
        ? readNonEmptyString(userSession.userId)
        : undefined;

    if (
      attemptId !== undefined &&
      userSession?.role === UserRole.LEARNER &&
      learnerUserId === undefined
    ) {
      this.logger.warn("attempt_access_denied: session carries no user id", {
        denial_reason: "missing_session_user_id",
        assignment_id: assignmentId,
        attempt_id: attemptId,
        group_id: sanitizeForLog(userSession?.groupId),
        method,
        url: sanitizeForLog(originalUrl),
      });
      return false;
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

      if (learnerUserId !== undefined) {
        whereClause.userId = learnerUserId;
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

    // Ownership is asserted against the row itself rather than inferred from
    // "a row came back", so the allowance below holds even if the query that
    // produced the row were ever widened.
    const attemptBelongsToLearner =
      learnerUserId !== undefined &&
      readAttemptOwnerId(attempt) === learnerUserId;

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
      // The browser session is a single unscoped cookie, so launching any
      // other quiz replaces this tab's groupId and the learner can no longer
      // open the results of work they already submitted here.
      //
      // An AssignmentGroup row answers "does this course embed this quiz?" —
      // it is not the authority on "is this the learner's own attempt?". For a
      // read of one specific attempt the server has already answered the
      // second question: the row was matched on (id, routeAssignmentId,
      // userId), all three from the route or the signed session, never from a
      // request body, and the row that came back is re-checked against the
      // session's user id. So allow the read and keep the group rule everywhere
      // else — writes, and any read not tied to an attempt this learner owns,
      // still require the link, which is what stops a session belonging to
      // another quiz from mutating or enumerating this one.
      const ownsRequestedAttempt =
        attemptId !== undefined && attemptBelongsToLearner;

      if (!ownsRequestedAttempt || !READ_ONLY_METHODS.has(method)) {
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

      this.logger.warn(
        "attempt_access_allowed: own attempt read without a current group link",
        {
          allow_reason: "owner_read_without_group_link",
          assignment_id: assignmentId,
          attempt_id: attemptId,
          session_assignment_id: userSession?.assignmentId,
          user_id: sanitizeForLog(userSession?.userId),
          group_id: sanitizeForLog(userSession?.groupId),
          method,
          url: sanitizeForLog(originalUrl),
        },
      );
    }

    if (
      attemptId !== undefined &&
      userSession.role === UserRole.LEARNER &&
      !attemptBelongsToLearner
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
