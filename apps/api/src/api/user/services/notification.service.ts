/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from "@nestjs/common";
import { EventEmitter } from "events";
import { PrismaService } from "src/prisma.service";

interface NotificationSubscription {
  userId: string;
  onNewNotification: (notification: any) => void;
  onMarkRead: (notificationId: number) => void;
}

@Injectable()
export class NotificationsService {
  private eventEmitter = new EventEmitter();
  private subscriptions = new Map<string, NotificationSubscription>();

  constructor(private readonly prisma: PrismaService) {}

  async getUserNotifications(userId: string) {
    return this.prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async markNotificationRead(id: number) {
    const numberId = Number(id);
    const notification = await this.prisma.userNotification.update({
      where: { id: numberId },
      data: { read: true },
    });

    // Emit event for real-time updates
    this.eventEmitter.emit(
      `notification:read:${notification.userId}`,
      numberId,
    );

    return notification;
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
    const notification = await this.prisma.userNotification.create({
      data: {
        userId,
        type,
        title,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null,
        read: false,
      },
    });

    // Emit event for real-time updates
    this.eventEmitter.emit(`notification:new:${userId}`, notification);

    return notification;
  }

  /**
   * Subscribe to real-time notification updates for a user
   */
  subscribeToUserNotifications(
    userId: string,
    onNewNotification: (notification: any) => void,
    onMarkRead: (notificationId: number) => void,
  ): () => void {
    const subscription: NotificationSubscription = {
      userId,
      onNewNotification,
      onMarkRead,
    };

    const subscriptionId = `${userId}_${Date.now()}`;
    this.subscriptions.set(subscriptionId, subscription);

    // Set up event listeners
    const newNotificationListener = (notification: any) => {
      onNewNotification(notification);
    };

    const markReadListener = (notificationId: number) => {
      onMarkRead(notificationId);
    };

    this.eventEmitter.on(`notification:new:${userId}`, newNotificationListener);
    this.eventEmitter.on(`notification:read:${userId}`, markReadListener);

    // Return cleanup function
    return () => {
      this.subscriptions.delete(subscriptionId);
      this.eventEmitter.off(
        `notification:new:${userId}`,
        newNotificationListener,
      );
      this.eventEmitter.off(`notification:read:${userId}`, markReadListener);
    };
  }
}
