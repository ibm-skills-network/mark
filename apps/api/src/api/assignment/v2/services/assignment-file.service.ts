import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
  private readonly logger = new Logger(AssignmentFileService.name);

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
              buffer: file.buffer,
            },
          ]);

        const extractionFailed = extractedFile.error !== undefined;

        uploadedObjects.push({
          bucket,
          key,
          file,
          extractedText: extractionFailed ? null : extractedFile.content,
          extractionStatus: extractionFailed
            ? AssignmentFileExtractionStatus.FAILED
            : AssignmentFileExtractionStatus.READY,
          extractionError: extractionFailed
            ? (extractedFile.error ?? null)
            : null,
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `uploadAssignmentFiles failed for assignment ${assignmentId}: ${errorMessage}`,
        errorStack,
      );
      // On DB failure, remove uploaded COS objects and let the caller retry the batch.
      await this.cleanupUploadedObjects(uploadedObjects);
      throw new InternalServerErrorException(
        "Failed to upload assignment files",
      );
    }
  }

  async getAssignmentFiles(
    assignmentId: number,
  ): Promise<{ files: AssignmentFileResponse[] }> {
    const files = await this.prisma.assignmentFile.findMany({
      where: { assignmentId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        assignmentId: true,
        filename: true,
        mimeType: true,
        size: true,
        storageKey: true,
        storageBucket: true,
        status: true,
        extractionStatus: true,
        extractionError: true,
        extractedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { files };
  }

  async deleteAssignmentFile(
    assignmentId: number,
    fileId: number,
  ): Promise<void> {
    const file = await this.prisma.assignmentFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }

    if (file.assignmentId !== assignmentId) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }

    await this.prisma.assignmentFile.delete({ where: { id: fileId } });

    await this.s3Service
      .deleteObject({ Bucket: file.storageBucket, Key: file.storageKey })
      .catch((error: unknown) => {
        // Logging and moving on: a dangling s3 object is preferable to returning a failure after the delete succeeded.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `File ${fileId} deleted from DB but S3 cleanup failed: ${message}`,
        );
      });
  }

  /**
   * Deletes all COS/S3 objects for every file belonging to an assignment.
   * Call this before deleting the assignment so the cascade-delete of
   * AssignmentFile rows does not leave orphaned objects in object storage.
   * DB rows are intentionally left intact here — the caller's cascade handles them.
   * S3 failures are logged as warnings rather than thrown so they never block
   * the assignment deletion.
   */
  async cleanupAssignmentFileObjects(assignmentId: number): Promise<void> {
    const files = await this.prisma.assignmentFile.findMany({
      where: { assignmentId },
      select: { id: true, storageKey: true, storageBucket: true },
    });

    // Promise.allSettled so a synchronous throw inside deleteObject (before it
    // returns a Promise) cannot bypass the per-call catch and block the deletion.
    await Promise.allSettled(
      files.map((file) =>
        this.s3Service
          .deleteObject({ Bucket: file.storageBucket, Key: file.storageKey })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Assignment ${assignmentId}: S3 cleanup failed for file ${file.id} (key=${file.storageKey}): ${message}`,
            );
          }),
      ),
    );
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
