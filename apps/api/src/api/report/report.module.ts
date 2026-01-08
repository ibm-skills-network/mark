import { HttpModule } from "@nestjs/axios";
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { raw } from "body-parser";
import { ConfigModule } from "@nestjs/config";
import { AdminAuthModule } from "src/auth/admin-auth.module";
import { PrismaService } from "src/database/prisma.service";
import { FilesService } from "../files/services/files.service";
import { S3Service } from "../files/services/s3.service";
import { ReportsController } from "./controllers/report.controller";
import { GithubWebhookController } from "./controllers/github-webhook.controller";
import { FloService } from "./services/flo.service";
import { ReportsService } from "./services/report.service";

@Module({
  providers: [
    ReportsService,
    FloService,
    PrismaService,
    FilesService,
    S3Service,
  ],
  controllers: [ReportsController, GithubWebhookController],
  imports: [ConfigModule, HttpModule, AdminAuthModule],
})
export class ReportsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(raw({ type: "*/*" }))
      .forRoutes({
        path: "reports/github/webhook",
        method: RequestMethod.POST,
      });
  }
}
