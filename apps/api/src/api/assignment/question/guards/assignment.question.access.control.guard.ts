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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queries: any[] = [
      this.prisma.assignment.findUnique({ where: { id: assignmentId } }),

      this.prisma.assignmentGroup.findFirst({
        where: {
          assignmentId,
          groupId: userSession.groupId,
        },
      }),
    ];

    if (questionId) {
      queries.push(
        this.prisma.question.findFirst({
          where: {
            id: questionId,
            assignmentId,
          },
        }),
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [assignment, assignmentGroup, questionInAssignment] =
      await this.prisma.$transaction(queries);

    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

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
