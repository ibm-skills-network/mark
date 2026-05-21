import { Module } from "@nestjs/common";
import { AttemptAccessCacheService } from "./attempt-access-cache.service";

@Module({
  providers: [AttemptAccessCacheService],
  exports: [AttemptAccessCacheService],
})
export class AttemptAccessCacheModule {}
