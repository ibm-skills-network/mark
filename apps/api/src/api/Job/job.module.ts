import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { JobStatusServiceV1 } from "./job-status.service";
import { PrismaService } from "src/prisma.service";

@Module({
  providers: [JobStatusServiceV1, PrismaService],
  exports: [JobStatusServiceV1],
  imports: [HttpModule],
})
export class JobModule {}
