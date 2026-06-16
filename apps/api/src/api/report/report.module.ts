import { HttpModule } from "@nestjs/axios";
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { raw } from "body-parser";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdminAuthModule } from "src/auth/admin-auth.module";
import { FilesService } from "../files/services/files.service";
import { S3Service } from "../files/services/s3.service";
import { ReportsController } from "./controllers/report.controller";
import { AdminReportsController } from "./controllers/admin-report.controller";
import { GithubWebhookController } from "./controllers/github-webhook.controller";
import { FloService } from "./services/flo.service";
import { ReportsService } from "./services/report.service";

@Module({
  providers: [ReportsService, FloService, FilesService, S3Service],
  controllers: [
    ReportsController,
    AdminReportsController,
    GithubWebhookController,
  ],
  imports: [
    ConfigModule,
    HttpModule,
    AdminAuthModule,
    // Infrastructure only — does NOT rate-limit any report route by itself.
    // Limiting applies solely to routes that opt in via @UseGuards(ThrottlerGuard)
    // + @Throttle, which today is just AdminReportsController#sendBugRenewalEmail.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 60 }]),
  ],
})
export class ReportsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(raw({ type: "*/*" })).forRoutes({
      path: "reports/github/webhook",
      method: RequestMethod.POST,
    });
  }
}
