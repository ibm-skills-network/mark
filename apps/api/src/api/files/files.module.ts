// files.module.ts
import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { memoryStorage } from "multer"; // ← import this
import { FilesController } from "./files.controller";
import { FilesService } from "./services/files.service";
import { S3Service } from "./services/s3.service";
import { PrismaService } from "src/prisma.service";

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService, S3Service, PrismaService],
  exports: [FilesService, S3Service],
})
export class FilesModule {}
