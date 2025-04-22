import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../prisma.service";

@Injectable()
export class AssignmentQuestionAccessControlGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const { userSession, params } = request;
    const { assignmentId: assignmentIdString, id } = params;
    const assignmentId = Number(assignmentIdString);

    const questionId = id ? Number(id) : undefined;

    // Construct the array of queries for the transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queries: any[] = [
      // Query to check if the assignment exists
      this.prisma.assignment.findUnique({ where: { id: assignmentId } }),
      // Query to check if the user's groupId is associated with this assignment
      this.prisma.assignmentGroup.findFirst({
        where: {
          assignmentId,
          groupId: userSession.groupId,
        },
      }),
    ];

    if (questionId) {
      // If the questionId is present, add query to check if it belongs to the specified assignmentId
      queries.push(
        this.prisma.question.findFirst({
          where: {
            id: questionId,
            assignmentId,
          },
        }),
      );
    }

    // Execute all queries in a transaction
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [assignment, assignmentGroup, questionInAssignment] =
      await this.prisma.$transaction(queries);

    // Check if the assignment exists
    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    // Check if the user's groupId is associated with the assignment
    if (!assignmentGroup) {
      return false;
    }

    if (questionId && !questionInAssignment) {
      throw new NotFoundException(
        "Question not found within the specified assignment",
      );
    }

    return true;
  }
}
