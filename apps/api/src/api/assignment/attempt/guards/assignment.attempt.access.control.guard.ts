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
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params } = request;
    const {
      assignmentId: assignmentIdString,
      attemptId: attemptIdString,
      questionId: questionIdString,
      role: role,
    } = params;
    const assignmentId = Number(assignmentIdString);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queries: any[] = [
      // Query to check if the assignment itself exists
      this.prisma.assignment.findUnique({ where: { id: assignmentId } }),
      // Query to check if the user's groupId is associated with the assignment
      this.prisma.assignmentGroup.findFirst({
        where: {
          assignmentId: assignmentId,
          groupId: userSession.groupId,
        },
      }),
    ];

    if (attemptIdString) {
      const attemptId = Number(attemptIdString);
      const whereClause: {
        id: number;
        assignmentId: number;
        userId?: string;
      } = {
        id: attemptId,
        assignmentId: assignmentId,
      };

      if (userSession.role === UserRole.LEARNER) {
        whereClause.userId = userSession.userId;
      }

      if (userSession.role === UserRole.LEARNER) {
        // check if attempt belongs to user
        const suspeciousUserId = userSession.userId;

        // grab userId using attemptId
        const userId = await this.prisma.assignmentAttempt.findUnique({
          where: {
            id: Number(attemptIdString),
          },
          select: {
            userId: true,
          },
        });
        if (userId.userId !== suspeciousUserId) {
          throw new NotFoundException(
            "Attempt not found or not owned by the user",
          );
        }
      }
      // Query to check if the attempt belongs to the assignment and is owned by the user (if they're a learner)
      queries.push(
        this.prisma.assignmentAttempt.findFirst({ where: whereClause }),
      );
    }

    if (questionIdString) {
      const questionId = Number(questionIdString);
      // Query to check if the question belongs to the assignment
      queries.push(
        this.prisma.question.findFirst({
          where: {
            id: questionId,
            assignmentId: assignmentId,
          },
        }),
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

    if (attemptIdString && !attempt && role === UserRole.LEARNER) {
      throw new NotFoundException("Attempt not found or not owned by the user");
    }

    if (questionIdString && !questionInAssignment) {
      throw new NotFoundException(
        "Question not found within the specified assignment",
      );
    }

    return true;
  }
}
