/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../../prisma.service";

@Injectable()
export class ChatAccessControlGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    let userSession: any;

    try {
      const userSessionHeader = request.headers["user-session"];
      if (userSessionHeader) {
        userSession =
          typeof userSessionHeader === "string"
            ? JSON.parse(userSessionHeader)
            : userSessionHeader;
      }
    } catch {
      throw new ForbiddenException("Invalid user session");
    }

    if (!userSession || !userSession.userId) {
      throw new ForbiddenException("Authentication required");
    }

    request.userSession = userSession;

    const { params, method, path } = request;

    if (params.chatId) {
      const chatId = params.chatId;

      const chat = await this.prisma.chat.findUnique({
        where: { id: chatId },
      });

      if (!chat) {
        throw new NotFoundException("Chat not found");
      }

      if (chat.userId !== userSession.userId) {
        if (chat.assignmentId) {
          const assignmentAccess = await this.checkAssignmentAccess(
            chat.assignmentId,
            userSession.groupId,
          );

          if (!assignmentAccess) {
            throw new ForbiddenException("Access denied to this chat");
          }

          return true;
        }

        throw new ForbiddenException("Access denied to this chat");
      }

      return true;
    } else if (path.includes("/user/")) {
      const userId = params.userId;

      if (userId !== userSession.userId && userSession.role !== "admin") {
        throw new ForbiddenException("Access denied to other users' chats");
      }

      return true;
    } else if (method === "POST") {
      const body = request.body;
      if (
        body &&
        body.userId &&
        body.userId !== userSession.userId &&
        userSession.role !== "admin"
      ) {
        throw new ForbiddenException("Cannot create chats for other users");
      }

      if (body && body.assignmentId) {
        const assignmentAccess = await this.checkAssignmentAccess(
          body.assignmentId,
          userSession.groupId,
        );

        if (!assignmentAccess) {
          throw new ForbiddenException("Access denied to this assignment");
        }
      }

      return true;
    }

    return true;
  }

  private async checkAssignmentAccess(
    assignmentId: number,
    groupId: string,
  ): Promise<boolean> {
    if (!groupId) return false;

    const assignmentGroup = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId,
        groupId,
      },
    });

    return !!assignmentGroup;
  }
}
