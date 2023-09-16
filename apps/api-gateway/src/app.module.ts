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
import { AppService } from "./app.service";
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
    RouterModule.register(routes),
    MessagingModule,
  ],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
