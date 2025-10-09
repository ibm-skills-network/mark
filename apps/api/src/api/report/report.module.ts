import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminAuthModule } from "src/auth/admin-auth.module";
import { PrismaService } from "src/prisma.service";
import { FilesService } from "../files/services/files.service";
import { S3Service } from "../files/services/s3.service";
import { ReportsController } from "./controllers/report.controller";
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
  controllers: [ReportsController],
  imports: [ConfigModule, HttpModule, AdminAuthModule],
})
export class ReportsModule {}
