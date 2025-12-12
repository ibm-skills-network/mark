import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { CacheService } from "./cache.service";

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
