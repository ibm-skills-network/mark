import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import {
  AssignmentFile,
  AssignmentFileExtractionStatus,
  AssignmentFileStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FileContentExtractionService } from "src/api/attempt/services/file-content-extraction";
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
  extractionStatus: AssignmentFileExtractionStatus;
  extractionError: string | null;
  extractedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AssignmentFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly fileContentExtractionService: FileContentExtractionService,
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
      extractedText: string | null;
      extractionStatus: AssignmentFileExtractionStatus;
      extractionError: string | null;
      extractedAt: Date | null;
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

        const [extractedFile] =
          await this.fileContentExtractionService.extractContentFromFiles([
            {
              filename: file.originalname,
              content: "InCos",
              fileType: file.mimetype || "application/octet-stream",
              bucket,
              key,
            },
          ]);

        // Extraction failures currently come back as content starting with "[ERROR".
        const extractionFailed = extractedFile.content.startsWith("[ERROR");

        uploadedObjects.push({
          bucket,
          key,
          file,
          extractedText: extractionFailed ? null : extractedFile.content,
          extractionStatus: extractionFailed
            ? AssignmentFileExtractionStatus.FAILED
            : AssignmentFileExtractionStatus.READY,
          extractionError: extractionFailed ? extractedFile.content : null,
          extractedAt: extractionFailed ? null : new Date(),
        });
      }

      const createdFiles = await this.prisma.$transaction(
        uploadedObjects.map(
          ({
            bucket,
            key,
            file,
            extractedText,
            extractionStatus,
            extractionError,
            extractedAt,
          }) =>
            this.prisma.assignmentFile.create({
              data: {
                assignmentId,
                filename: file.originalname,
                mimeType: file.mimetype || "application/octet-stream",
                size: file.size,
                storageKey: key,
                storageBucket: bucket,
                status: AssignmentFileStatus.READY,
                extractedText,
                extractionStatus,
                extractionError,
                extractedAt,
              },
            }),
        ),
      );

      return { files: createdFiles.map((file) => this.toResponse(file)) };
    } catch {
      // On DB failure, remove uploaded COS objects and let the caller retry the batch.
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

  private toResponse(file: AssignmentFile): AssignmentFileResponse {
    return {
      id: file.id,
      assignmentId: file.assignmentId,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      storageKey: file.storageKey,
      storageBucket: file.storageBucket,
      status: file.status,
      extractionStatus: file.extractionStatus,
      extractionError: file.extractionError,
      extractedAt: file.extractedAt,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }
}
