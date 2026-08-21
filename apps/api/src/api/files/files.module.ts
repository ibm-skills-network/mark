import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { ThrottlerModule } from "@nestjs/throttler";
import { memoryStorage } from "multer";

import { FilesController } from "./files.controller";
import { UserThrottlerGuard } from "./guards/user-throttler.guard";
import { FilesService } from "./services/files.service";
import { S3Service } from "./services/s3.service";

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
    // Infrastructure only — no file route is limited by this on its own.
    // Limiting applies to routes that opt in with @UseGuards(UserThrottlerGuard)
    // + @Throttle, which today is just direct-upload: the one route that
    // buffers a whole file in pod memory.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 30 }]),
  ],
  controllers: [FilesController],
  providers: [FilesService, S3Service, UserThrottlerGuard],
  exports: [FilesService, S3Service],
})
export class FilesModule {}
