import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { GithubController } from "./github.controller";
import { GithubService } from "./github.service";

@Module({
  controllers: [GithubController],
  providers: [GithubService, PrismaService],
  exports: [GithubService],
  imports: [HttpModule],
})
export class GithubModule {}
