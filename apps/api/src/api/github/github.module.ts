import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { GithubController } from "./github.controller";
import { GithubService } from "./github.service";

@Module({
  controllers: [GithubController],
  providers: [GithubService],
  exports: [GithubService],
  imports: [HttpModule],
})
export class GithubModule {}
