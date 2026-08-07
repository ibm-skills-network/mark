import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  UserSession,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Logger } from "winston";
import { PrismaService } from "../../../database/prisma.service";

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
    const assignmentId =
      Number(parameterAssignmentId) || Number(id) || userSession.assignmentId;
    if (!assignmentId || Number.isNaN(assignmentId)) {
      this.logger.warn("assignment_access_denied: invalid assignment id", {
        denial_reason: "invalid_assignment_id",
        param_id: id,
        param_assignmentId: parameterAssignmentId,
        session_assignmentId: userSession?.assignmentId,
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new ForbiddenException("Invalid assignment ID");
    }

    const [assignmentGroup, assignment] = await this.prisma.$transaction([
      this.prisma.assignmentGroup.findFirst({
        where: {
          assignmentId: assignmentId,
          groupId: userSession.groupId,
        },
      }),
      this.prisma.assignment.findUnique({
        where: { id: assignmentId },
      }),
    ]);

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
        userSession.assignmentId === assignmentId &&
        typeof userSession.groupId === "string" &&
        userSession.groupId.length > 0;

      if (launchDeclaresThisAssignment) {
        await this.createLaunchDerivedGroupLink(
          assignmentId,
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
              where: { id: userSession.groupId },
              create: { id: userSession.groupId },
            },
          },
        },
      });
      this.logger.warn(
        "assignment_group_auto_linked: created missing group link from signed launch session",
        {
          assignment_id: assignmentId,
          group_id: userSession.groupId,
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
          group_id: userSession.groupId,
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
