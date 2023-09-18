import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  UserRole,
  UserSessionRequest,
} from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../prisma.service";

@Injectable()
export class AssignmentAttemptAccessControlGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params } = request;
    const { assignmentId, attemptId, questionId } = params;

    const assignmentID = Number(assignmentId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queries: any[] = [
      // Query to check if the assignment itself exists
      this.prisma.assignment.findUnique({ where: { id: assignmentID } }),
      // Query to check if the user's groupId is associated with the assignment
      this.prisma.assignmentGroup.findFirst({
        where: {
          assignmentId: assignmentID,
          groupId: userSession.groupID,
        },
      }),
    ];

    if (attemptId) {
      const attemptID = Number(attemptId);
      const whereClause: {
        id: number;
        assignmentId: number;
        userId?: string;
      } = {
        id: attemptID,
        assignmentId: assignmentID,
      };

      if (userSession.role === UserRole.LEARNER) {
        whereClause.userId = userSession.userID;
      }

      // Query to check if the attempt belongs to the assignment and is owned by the user (if they're a learner)
      queries.push(
        this.prisma.assignmentAttempt.findFirst({ where: whereClause })
      );
    }

    if (questionId) {
      const questionID = Number(questionId);
      // Query to check if the question belongs to the assignment
      queries.push(
        this.prisma.question.findFirst({
          where: {
            id: questionID,
            assignmentId: assignmentID,
          },
        })
      );
    }

    // Execute all queries in a transaction
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [assignment, assignmentGroup, attempt, questionInAssignment] =
      await this.prisma.$transaction(queries);

    // Check if the assignment exists
    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    // Check if the user's groupId is associated with it
    if (!assignmentGroup) {
      return false;
    }

    if (attemptId && !attempt) {
      throw new NotFoundException("Attempt not found or not owned by the user");
    }

    if (questionId && !questionInAssignment) {
      throw new NotFoundException(
        "Question not found within the specified assignment"
      );
    }

    return true;
  }
}
