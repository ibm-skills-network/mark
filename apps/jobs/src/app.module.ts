import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { WinstonModule } from "nest-winston";
import { winstonOptions } from "./logger.config";
import { JobWorkerService } from "./job-worker.service";

@Module({
  imports: [ConfigModule.forRoot(), WinstonModule.forRoot(winstonOptions)],
  providers: [JobWorkerService],
})
export class JobsAppModule {}
