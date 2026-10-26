import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Logger } from "winston";
import { PrismaService } from "../../../database/prisma.service";

const NO_GROUP_LINK_HEAL_KEY = "assignmentAccess:noGroupLinkHeal";

/** Routes that must never create a missing group link (read-only probes). */
export const NoGroupLinkHeal = () => SetMetadata(NO_GROUP_LINK_HEAL_KEY, true);

const MAX_INT32 = 2_147_483_647;

/** ParseIntPipe's acceptance rule, so the guard answers before the pipe would. */
const INT_PIPE_PATTERN = /^-?\d+$/;

type RouteAssignmentId =
  | { kind: "id"; value: number }
  | { kind: "unaddressable" }
  | { kind: "malformed" };

// Integers outside 1..int32 cannot name a row, so they read as "not found".
const parseRouteAssignmentId = (raw: string): RouteAssignmentId => {
  if (!INT_PIPE_PATTERN.test(raw)) return { kind: "malformed" };
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_INT32
    ? { kind: "id", value }
    : { kind: "unaddressable" };
};

const readNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

@Injectable()
export class AssignmentAccessControlGuard implements CanActivate {
  private readonly logger: Logger;

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: AssignmentAccessControlGuard.name,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params, method, originalUrl } = request;
    const { id, assignmentId: parameterAssignmentId } = params;
    const rawRouteId = parameterAssignmentId ?? id;

    let assignmentId: number | undefined;
    if (rawRouteId === undefined) {
      // Only routes that name no assignment at all act on the launch's own.
      assignmentId =
        typeof userSession?.assignmentId === "number" &&
        Number.isSafeInteger(userSession.assignmentId) &&
        userSession.assignmentId > 0
          ? userSession.assignmentId
          : undefined;
      if (assignmentId === undefined) {
        this.logger.warn("assignment_access_denied: invalid assignment id", {
          denial_reason: "invalid_assignment_id",
          session_assignmentId: userSession?.assignmentId,
          user_id: userSession?.userId,
          method,
          url: originalUrl,
        });
        throw new ForbiddenException("Invalid assignment ID");
      }
    } else {
      const parsed = parseRouteAssignmentId(rawRouteId);
      if (parsed.kind === "malformed") {
        this.logger.warn("assignment_access_denied: malformed assignment id", {
          denial_reason: "malformed_assignment_id",
          user_id: userSession?.userId,
          method,
          url: originalUrl,
        });
        throw new BadRequestException(
          "Validation failed (numeric string is expected)",
        );
      }
      assignmentId = parsed.kind === "id" ? parsed.value : undefined;
    }

    // A shared LTI group is not permission to edit every quiz in that group.
    // AWB/CM authorize collaborators before issuing a launch for this quiz.
    if (
      userSession.role === UserRole.AUTHOR &&
      (assignmentId === undefined || userSession.assignmentId !== assignmentId)
    ) {
      this.logger.warn(
        "assignment_access_denied: author launch targets another assignment",
        {
          assignment_id: assignmentId,
          session_assignment_id: userSession.assignmentId,
          user_id: userSession.userId,
        },
      );
      throw new ForbiddenException("Access denied to this assignment");
    }

    if (assignmentId === undefined) {
      this.logger.warn("assignment_access_denied: assignment not found", {
        denial_reason: "assignment_not_found",
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new NotFoundException("Assignment not found");
    }

    // Prisma drops `groupId: undefined` from a where clause, which would match
    // any group's link, so an absent group never reaches the link query.
    const groupId = readNonEmptyString(userSession?.groupId);
    let assignmentGroup: unknown = null;
    let assignment: unknown;
    if (groupId === undefined) {
      assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
      });
    } else {
      [assignmentGroup, assignment] = await this.prisma.$transaction([
        this.prisma.assignmentGroup.findFirst({
          where: { assignmentId, groupId },
        }),
        this.prisma.assignment.findUnique({
          where: { id: assignmentId },
        }),
      ]);
    }

    if (!assignment) {
      this.logger.warn("assignment_access_denied: assignment not found", {
        denial_reason: "assignment_not_found",
        assignment_id: assignmentId,
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new NotFoundException("Assignment not found");
    }

    if (!assignmentGroup) {
      // The session JWT is minted by the LTI credentials manager at launch
      // time, so a signed (assignmentId, groupId) pair is the embedding
      // course's own declaration that it hosts this assignment. Upstream
      // provisioning (context-manager, hand-wired Studio embeds) sometimes
      // skips the admin link call; heal the link here instead of locking
      // every learner out.
      //
      // This makes AssignmentGroup rows a materialization of course embeds,
      // not an independent authorization root: deleting a row does not revoke
      // access while still-valid launch sessions for the pair exist — the
      // next request re-creates it. Revoking a course's access means removing
      // the embed so no new sessions are minted; a hard block while the embed
      // remains would need an explicit revocation marker checked before the
      // heal, since row state alone cannot distinguish "never linked" from
      // "unlinked".
      const launchDeclaresThisAssignment =
        userSession.assignmentId === assignmentId && groupId !== undefined;
      const healDisabled =
        this.reflector.getAllAndOverride<boolean | undefined>(
          NO_GROUP_LINK_HEAL_KEY,
          [context.getHandler(), context.getClass()],
        ) === true;

      if (launchDeclaresThisAssignment && !healDisabled) {
        await this.createLaunchDerivedGroupLink(
          assignmentId,
          groupId,
          userSession,
          method,
          originalUrl,
        );
        return true;
      }

      this.logger.warn(
        "assignment_access_denied: user's group has no link to this assignment",
        {
          denial_reason: "no_group_link",
          assignment_id: assignmentId,
          user_id: userSession?.userId,
          group_id: userSession?.groupId,
          method,
          url: originalUrl,
        },
      );
      throw new ForbiddenException("Access denied to this assignment");
    }

    return true;
  }

  private async createLaunchDerivedGroupLink(
    assignmentId: number,
    groupId: string,
    userSession: UserSession,
    method: string,
    originalUrl: string,
  ): Promise<void> {
    try {
      await this.prisma.assignmentGroup.create({
        data: {
          assignment: { connect: { id: assignmentId } },
          group: {
            connectOrCreate: {
              where: { id: groupId },
              create: { id: groupId },
            },
          },
        },
      });
      this.logger.warn(
        "assignment_group_auto_linked: created missing group link from signed launch session",
        {
          assignment_id: assignmentId,
          group_id: groupId,
          user_id: userSession.userId,
          method,
          url: originalUrl,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Lost a unique race to a concurrent launch. Either the link row or
        // the Group row (via connectOrCreate) was just created by the other
        // request; if only the Group row landed, the next request completes
        // the link. Allow this one either way.
        return;
      }
      this.logger.error(
        "assignment_group_auto_link_failed: could not create group link",
        {
          assignment_id: assignmentId,
          group_id: groupId,
          user_id: userSession.userId,
          method,
          url: originalUrl,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }
}
