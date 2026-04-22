import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/database/prisma.service";
import { Logger } from "winston";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger: Logger;

  constructor(
    private prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: "FilesAuthGuard" });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params, method, originalUrl } = request;
    const { id } = params;
    const assignmentId = Number(id) || userSession?.assignmentId;
    if (!assignmentId || Number.isNaN(assignmentId)) {
      this.logger.warn("files_auth_denied: invalid assignment id", {
        denial_reason: "invalid_assignment_id",
        param_id: id,
        session_assignmentId: userSession?.assignmentId,
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new ForbiddenException("Invalid assignment ID");
    }

    if (!userSession || !userSession.groupId) {
      this.logger.warn("files_auth_denied: user session or group missing", {
        denial_reason: "missing_session_or_group",
        has_session: !!userSession,
        has_group: !!userSession?.groupId,
        method,
        url: originalUrl,
      });
      throw new ForbiddenException("User session or group ID is missing");
    }
    if (!userSession.assignmentId) {
      this.logger.warn("files_auth_denied: session missing assignmentId", {
        denial_reason: "missing_session_assignmentId",
        user_id: userSession?.userId,
        group_id: userSession?.groupId,
        method,
        url: originalUrl,
      });
      throw new ForbiddenException("Assignment ID is missing in user session");
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
      this.logger.warn("files_auth_denied: assignment not found", {
        denial_reason: "assignment_not_found",
        assignment_id: assignmentId,
        user_id: userSession?.userId,
        method,
        url: originalUrl,
      });
      throw new NotFoundException("Assignment not found");
    }

    if (!assignmentGroup) {
      this.logger.warn("files_auth_denied: no group link", {
        denial_reason: "no_group_link",
        assignment_id: assignmentId,
        user_id: userSession?.userId,
        group_id: userSession?.groupId,
        method,
        url: originalUrl,
      });
      throw new ForbiddenException("Access denied to this assignment");
    }

    return true;
  }
}
