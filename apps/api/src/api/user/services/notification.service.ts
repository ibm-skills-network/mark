/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserNotifications(userId: string) {
    return this.prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async markNotificationRead(id: number) {
    const numberId = Number(id);
    return this.prisma.userNotification.update({
      where: { id: numberId },
      data: { read: true },
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.userNotification.count({
      where: { userId, read: false },
    });
  }

  async createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    metadata?: any,
  ) {
    return this.prisma.userNotification.create({
      data: {
        userId,
        type,
        title,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null,
        read: false,
      },
    });
  }
}
