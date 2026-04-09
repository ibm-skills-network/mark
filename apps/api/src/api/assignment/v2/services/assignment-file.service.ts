import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { AssignmentFileStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { S3Service } from "src/api/files/services/s3.service";
import { PrismaService } from "src/database/prisma.service";

export interface AssignmentFileResponse {
  id: number;
  assignmentId: number;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  storageBucket: string;
  status: AssignmentFileStatus;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AssignmentFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async uploadAssignmentFiles(
    assignmentId: number,
    files: Express.Multer.File[],
  ): Promise<{ files: AssignmentFileResponse[] }> {
    if (!files || files.length === 0) {
      throw new BadRequestException("No files provided");
    }

    const bucket = this.s3Service.getBucketName("author");
    if (!bucket) {
      throw new BadRequestException("Author upload bucket is not configured");
    }

    const uploadedObjects: Array<{
      bucket: string;
      key: string;
      file: Express.Multer.File;
    }> = [];

    try {
      for (const file of files) {
        const key = this.generateStorageKey(assignmentId, file.originalname);

        await this.s3Service.putObject({
          Bucket: bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        });

        uploadedObjects.push({ bucket, key, file });
      }

      return { files: [] };
    } catch (error) {
      await this.cleanupUploadedObjects(uploadedObjects);
      throw new InternalServerErrorException(
        "Failed to upload assignment files",
      );
    }
  }

  private generateStorageKey(assignmentId: number, filename: string): string {
    const safeFilename = this.toSafeFilename(filename);
    return `assignments/${assignmentId}/files/${randomUUID()}-${safeFilename}`;
  }

  private toSafeFilename(filename: string): string {
    const sanitized = filename
      .replaceAll(/[/\\]/g, "-")
      .replaceAll(/[^\w !'().-]/g, "_")
      .trim();

    return sanitized || "file";
  }

  private async cleanupUploadedObjects(
    uploadedObjects: Array<{ bucket: string; key: string }>,
  ): Promise<void> {
    await Promise.allSettled(
      uploadedObjects.map(({ bucket, key }) =>
        this.s3Service.deleteObject({ Bucket: bucket, Key: key }),
      ),
    );
  }
}
