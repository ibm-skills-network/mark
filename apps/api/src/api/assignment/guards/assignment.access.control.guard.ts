import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "../../../prisma.service";

@Injectable()
export class AssignmentAccessControlGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params } = request;
    const { id, assignmentId: parameterAssignmentId } = params;
    const assignmentId =
      Number(parameterAssignmentId) || Number(id) || userSession.assignmentId;
    if (!assignmentId || Number.isNaN(assignmentId)) {
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
      throw new NotFoundException("Assignment not found");
    }

    if (!assignmentGroup) {
      throw new ForbiddenException("Access denied to this assignment");
    }

    return true;
  }
}
