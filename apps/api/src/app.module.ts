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
import { ScheduledTasksModule } from "./api/scheduled-tasks/scheduled-tasks.module";
import { AppService } from "./app.service";
import { AdminAuthModule } from "./auth/admin-auth.module";
import { AuthModule } from "./auth/auth.module";
import { UserSessionMiddleware } from "./auth/middleware/user.session.middleware";
import { HealthModule } from "./health/health.module";
import { winstonOptions } from "./logger/config";
import { LoggerMiddleware } from "./logger/logger.middleware";
import { MessagingModule } from "./messaging/messaging.module";
import { routes } from "./routes";

@Module({
  imports: [
    ConfigModule.forRoot(),
    WinstonModule.forRoot(winstonOptions),
    HealthModule,
    ApiModule,
    ScheduledTasksModule,
    RouterModule.register(routes),
    MessagingModule,
    AuthModule,
    AdminAuthModule,
  ],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.ALL })
      .apply(UserSessionMiddleware)
      .forRoutes(
        { path: "/v1/assignments*", method: RequestMethod.ALL },
        { path: "/v1/github*", method: RequestMethod.ALL },
        { path: "/v1/user-session", method: RequestMethod.GET },
        { path: "/v1/reports*", method: RequestMethod.ALL },
        { path: "/v1/chats*", method: RequestMethod.ALL },
        { path: "/v1/notifications*", method: RequestMethod.ALL },
        { path: "/v1/files*", method: RequestMethod.ALL },
        { path: "/v1/admin*", method: RequestMethod.ALL },
        { path: "/v2/assignments/*", method: RequestMethod.ALL },
        { path: "/v1/admin-dashboard/*", method: RequestMethod.GET },
      );
  }
}
