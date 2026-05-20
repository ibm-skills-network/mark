import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, RouterModule } from "@nestjs/core";
import { WinstonModule } from "nest-winston";
import { ApiModule } from "./api/api.module";
import { AppService } from "./app.service";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
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
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: "{*splat}", method: RequestMethod.ALL });
  }
}
