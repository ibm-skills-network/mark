/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class ChatAccessControlGuard implements CanActivate {
  private readonly logger: Logger;

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: ChatAccessControlGuard.name,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { method, originalUrl, path, headers } = request;

    let userSession: any;

    try {
      const userSessionHeader = headers["user-session"];
      if (userSessionHeader) {
        userSession =
          typeof userSessionHeader === "string"
            ? JSON.parse(userSessionHeader)
            : userSessionHeader;
      }
    } catch (parseError) {
      this.logger.warn("chat_access_denied: user-session header parse failed", {
        denial_reason: "invalid_user_session_header",
        error:
          parseError instanceof Error ? parseError.message : String(parseError),
        method,
        url: originalUrl,
      });
      throw new ForbiddenException("Invalid user session");
    }

    if (!userSession || !userSession.userId) {
      this.logger.warn("chat_access_denied: missing session or userId", {
        denial_reason: "no_session",
        has_session: !!userSession,
        method,
        url: originalUrl,
      });
      throw new ForbiddenException("Authentication required");
    }

    request.userSession = userSession;

    const { params } = request;

    if (params.chatId) {
      const chatId = params.chatId;

      const chat = await this.prisma.chat.findUnique({
        where: { id: chatId },
      });

      if (!chat) {
        this.logger.warn("chat_access_denied: chat not found", {
          denial_reason: "chat_not_found",
          chat_id: chatId,
          user_id: userSession.userId,
          method,
          url: originalUrl,
        });
        throw new NotFoundException("Chat not found");
      }

      if (chat.userId !== userSession.userId) {
        if (chat.assignmentId) {
          const assignmentAccess = await this.checkAssignmentAccess(
            chat.assignmentId,
            userSession.groupId,
          );

          if (!assignmentAccess) {
            this.logger.warn(
              "chat_access_denied: assignment-linked chat, no group link",
              {
                denial_reason: "no_assignment_access",
                chat_id: chatId,
                chat_owner: chat.userId,
                requesting_user_id: userSession.userId,
                assignment_id: chat.assignmentId,
                group_id: userSession.groupId,
                method,
                url: originalUrl,
              },
            );
            throw new ForbiddenException("Access denied to this chat");
          }

          return true;
        }

        this.logger.warn("chat_access_denied: not chat owner", {
          denial_reason: "not_chat_owner",
          chat_id: chatId,
          chat_owner: chat.userId,
          requesting_user_id: userSession.userId,
          method,
          url: originalUrl,
        });
        throw new ForbiddenException("Access denied to this chat");
      }

      return true;
    } else if (path.includes("/user/")) {
      const userId = params.userId;

      if (userId !== userSession.userId && userSession.role !== "admin") {
        this.logger.warn(
          "chat_access_denied: cross-user chat list access by non-admin",
          {
            denial_reason: "cross_user_non_admin",
            target_user_id: userId,
            requesting_user_id: userSession.userId,
            requesting_role: userSession.role,
            method,
            url: originalUrl,
          },
        );
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
        this.logger.warn(
          "chat_access_denied: cross-user chat creation by non-admin",
          {
            denial_reason: "create_for_other_user",
            target_user_id: body.userId,
            requesting_user_id: userSession.userId,
            requesting_role: userSession.role,
            method,
            url: originalUrl,
          },
        );
        throw new ForbiddenException("Cannot create chats for other users");
      }

      if (body && body.assignmentId) {
        const assignmentAccess = await this.checkAssignmentAccess(
          body.assignmentId,
          userSession.groupId,
        );

        if (!assignmentAccess) {
          this.logger.warn(
            "chat_access_denied: cannot create chat for inaccessible assignment",
            {
              denial_reason: "no_assignment_access_on_create",
              assignment_id: body.assignmentId,
              user_id: userSession.userId,
              group_id: userSession.groupId,
              method,
              url: originalUrl,
            },
          );
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
