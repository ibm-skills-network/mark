import { Module } from "@nestjs/common";
import { ReportsController } from "./controllers/report.controller";
import { FloService } from "./services/flo.service";
import { ReportsService } from "./services/report.service";
import { ConfigModule } from "@nestjs/config";
import { HttpModule } from "@nestjs/axios";

@Module({
  providers: [ReportsService, FloService],
  controllers: [ReportsController],
  imports: [ConfigModule, HttpModule],
})
export class ReportsModule {}
