import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../prisma.service";

@Injectable()
export class AssignmentQuestionAccessControlGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params } = request;
    const { assignmentId: assignmentIdString, id } = params;
    const assignmentId = Number(assignmentIdString);

    // Check if the logged-in user's groupId is associated with this assignment
    const assignmentGroup = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId,
        groupId: userSession.groupID,
      },
    });

    if (!assignmentGroup) {
      // The user's group is not associated with this assignment
      return false;
    }

    // Check if questionId is present in params
    if (id) {
      const questionID = Number(id);

      // Check if the questionId from params actually belongs to the assignmentId
      const questionInAssignment = await this.prisma.question.findFirst({
        where: {
          id: questionID,
          assignmentId,
        },
      });

      return !!questionInAssignment;
    }

    // If there is no questionId in params, the guard passes
    return true;
  }
}
