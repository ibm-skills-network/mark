import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params } = request;
    const { id } = params;
    const assignmentId = Number(id) || userSession.assignmentId;
    if (!assignmentId || Number.isNaN(assignmentId)) {
      throw new ForbiddenException("Invalid assignment ID");
    }

    console.log(
      `AuthGuard: Checking access for assignment ID ${assignmentId} and group ID ${userSession.groupId}`,
    );
    if (!userSession || !userSession.groupId) {
      throw new ForbiddenException("User session or group ID is missing");
    }
    if (!userSession.assignmentId) {
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
    console.log(
      `AuthGuard: Found assignmentGroup: ${
        assignmentGroup ? "exists" : "not found"
      }, assignment: ${assignment ? "exists" : "not found"}`,
    );
    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    if (!assignmentGroup) {
      throw new ForbiddenException("Access denied to this assignment");
    }

    return true;
  }
}
