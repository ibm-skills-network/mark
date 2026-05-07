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
}
