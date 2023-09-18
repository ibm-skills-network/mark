import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  UserRole,
  UserSessionRequest,
} from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../prisma.service";

@Injectable()
export class AssignmentSubmissionAccessControlGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params } = request;
    const { assignmentId, submissionId, questionId } = params;

    const assignmentID = Number(assignmentId);

    // Check if the logged-in user's groupId is associated with this assignment
    const assignmentGroup = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId: assignmentID,
        groupId: userSession.groupID,
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

      if (userSession.role === UserRole.LEARNER) {
        whereClause.userId = userSession.userID; //check if learner actually owns this submission
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
