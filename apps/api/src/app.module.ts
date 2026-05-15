import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RouterModule } from "@nestjs/core";
import { WinstonModule } from "nest-winston";
import { ApiModule } from "./api/api.module";
import { FileProcessingBudgetModule } from "./api/files/file-processing-budget.module";
import { ScheduledTasksModule } from "./api/scheduled-tasks/scheduled-tasks.module";
import { AppService } from "./app.service";
import { AdminAuthModule } from "./auth/admin-auth.module";
import { AuthModule } from "./auth/auth.module";
import { UserSessionMiddleware } from "./auth/middleware/user.session.middleware";
import { CommonModule } from "./common/common.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { JobQueueModule } from "./job-queue/job-queue.module";
import { winstonOptions } from "./logger/config";
import { LoggerMiddleware } from "./logger/logger.middleware";
import { MessagingModule } from "./messaging/messaging.module";
import { routes } from "./routes";

@Module({
  imports: [
    ConfigModule.forRoot(),
    WinstonModule.forRoot(winstonOptions),
    HealthModule,
    CommonModule,
    ApiModule,
    ScheduledTasksModule,
    RouterModule.register(routes),
    MessagingModule,
    AuthModule,
    AdminAuthModule,
    DatabaseModule,
    FileProcessingBudgetModule,
    JobQueueModule,
  ],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: "{*splat}", method: RequestMethod.ALL })
      .apply(UserSessionMiddleware)
      .forRoutes(
        { path: "/v1/assignments{/*splat}", method: RequestMethod.ALL },
        { path: "/v1/github{/*splat}", method: RequestMethod.ALL },
        { path: "/v1/user-session", method: RequestMethod.GET },
        { path: "/v1/reports{/*splat}", method: RequestMethod.ALL },
        { path: "/v1/chats{/*splat}", method: RequestMethod.ALL },
        { path: "/v1/files{/*splat}", method: RequestMethod.ALL },
        { path: "/v1/admin/translations{/*splat}", method: RequestMethod.ALL },
        { path: "/v2/assignments{/*splat}", method: RequestMethod.ALL },
        { path: "/v1/admin-dashboard{/*splat}", method: RequestMethod.GET },
      );
  }
}
