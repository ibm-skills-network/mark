import { Controller, Get, Injectable, Param, Post, Req } from "@nestjs/common";
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
  async markNotificationRead(@Param("id") id: number) {
    return this.notificationsService.markNotificationRead(id);
  }
}
