import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRequest } from "../../../../auth/interfaces/user.interface";
import { PrismaService } from "../../../../prisma.service";

@Injectable()
export class AssignmentQuestionAccessControlGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = context.switchToHttp().getRequest<UserRequest>();
    const { user, params } = request;
    const { assignmentId, id } = params;
    const assingmentID = Number(assignmentId);

    // Check if the logged-in user's groupId is associated with this assignment
    const assignmentGroup = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId: assingmentID,
        groupId: user.groupID,
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
          assignmentId: assingmentID,
        },
      });

      return !!questionInAssignment;
    }

    // If there is no questionId in params, the guard passes
    return true;
  }
}
