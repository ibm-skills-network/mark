import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { JobStatusServiceV1 } from "./job-status.service";

@Module({
  providers: [JobStatusServiceV1, PrismaService],
  exports: [JobStatusServiceV1],
  imports: [HttpModule],
})
export class JobModule {}
