import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRequest } from "../../../auth/interfaces/user.interface";
import { PrismaService } from "../../../prisma.service";

@Injectable()
export class AssignmentAccessControlGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = context.switchToHttp().getRequest<UserRequest>();
    const { user, params } = request;
    const { id } = params;
    const assingmentID = Number(id);

    // Check if the logged-in user's (can be either learner or author) groupId is associated with this assignment
    const assignmentGroup = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId: assingmentID,
        groupId: user.groupID,
      },
    });

    return !!assignmentGroup;
  }
}
