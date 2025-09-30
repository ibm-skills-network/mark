import {
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { NotificationsService } from "../services/notification.service";

@Injectable()
@Controller({
  path: "notifications",
  version: "1",
})
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get("user")
  async getUserNotifications(@Req() request: UserSessionRequest) {
    const userId = request.userSession.userId;
    return this.notificationsService.getUserNotifications(userId);
  }

  @Get("user/unread")
  async getUnreadCount(@Req() request: UserSessionRequest) {
    const userId = request.userSession.userId;
    return { count: await this.notificationsService.getUnreadCount(userId) };
  }

  @Post("mark-read/:id")
  async markNotificationRead(@Param("id") id: string) {
    return this.notificationsService.markNotificationRead(Number(id));
  }

  @Get("stream")
  async streamNotifications(
    @Req() request: UserSessionRequest,
    @Res() response: Response,
  ) {
    const userId = request.userSession.userId;

    // Set SSE headers
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Cache-Control");

    // Send initial notifications
    const initialNotifications =
      await this.notificationsService.getUserNotifications(userId);
    response.write(
      `data: ${JSON.stringify({
        type: "initial",
        notifications: initialNotifications,
      })}\n\n`,
    );

    // Set up real-time updates
    const cleanup = this.notificationsService.subscribeToUserNotifications(
      userId,
      (notification) => {
        response.write(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          `data: ${JSON.stringify({ type: "new", notification })}\n\n`,
        );
      },
      (notificationId) => {
        response.write(
          `data: ${JSON.stringify({ type: "read", notificationId })}\n\n`,
        );
      },
    );

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      response.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`);
    }, 30_000);

    // Handle client disconnect
    request.on("close", () => {
      clearInterval(heartbeat);
      cleanup();
      response.end();
    });

    request.on("error", () => {
      clearInterval(heartbeat);
      cleanup();
      response.end();
    });
  }
}
