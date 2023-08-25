import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  UserRequest,
  UserRole,
} from "../../../../auth/interfaces/user.interface";
import { PrismaService } from "../../../../prisma.service";

@Injectable()
export class AssignmentSubmissionAccessControlGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserRequest>();
    const { user, params } = request;
    const { assignmentId, submissionId, questionId } = params;

    const assignmentID = Number(assignmentId);

    // Check if the logged-in user's groupId is associated with this assignment
    const assignmentGroup = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId: assignmentID,
        groupId: user.groupID,
      },
    });

    if (!assignmentGroup) {
      // The user's group is not associated with this assignment
      return false;
    }

    if (submissionId) {
      const submissionID = Number(submissionId);

      const whereClause: { [key: string]: number | string } = {
        //check if submission actually belongs to the assignmentID provided
        id: submissionID,
        assignmentId: assignmentID,
      };

      if (user.role === UserRole.LEARNER) {
        whereClause.userId = user.userID; //check if learner actually owns this submission
      }

      const submission = await this.prisma.assignmentSubmission.findFirst({
        where: whereClause,
      });

      if (!submission) {
        return false;
      }
    }

    if (questionId) {
      const questionID = Number(questionId);
      // Check if the questionId from params actually belongs to the assignmentId
      const questionInAssignment = await this.prisma.question.findFirst({
        where: {
          id: questionID,
          assignmentId: assignmentID,
        },
      });

      if (!questionInAssignment) {
        // The question doesn't belong to this assignment
        return false;
      }
    }

    return true;
  }
}
