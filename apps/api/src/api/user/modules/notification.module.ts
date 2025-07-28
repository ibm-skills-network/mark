import { Module } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";
import { NotificationsController } from "../controllers/notification.controller";
import { NotificationsService } from "../services/notification.service";

@Module({
  providers: [NotificationsService, PrismaService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
