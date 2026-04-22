import {
  BadRequestException,
  Injectable,
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
import {
  CompleteAssignmentFileDto,
  InitiateAssignmentFileItemResponseDto,
  InitiateAssignmentFilesDto,
  InitiateAssignmentFilesResponseDto,
} from "../dtos/assignment-file-upload.dto";

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

const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PRESIGNED_URL_TTL_SECONDS = 300;
const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 120;

@Injectable()
export class AssignmentFileService {
  private readonly logger = new Logger(AssignmentFileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly fileContentExtractionService: FileContentExtractionService,
  ) {}

  async initiateAssignmentFileUploads(
    assignmentId: number,
    dto: InitiateAssignmentFilesDto,
    userId: string,
  ): Promise<InitiateAssignmentFilesResponseDto> {
    const bucket = this.s3Service.getBucketName("author");
    const partSizeBytes = this.getMultipartPartSizeBytes();
    const expiresInSeconds = this.getPresignedUrlTtlSeconds();

    const uploads: InitiateAssignmentFileItemResponseDto[] = [];

    for (const file of dto.files) {
      const key = this.generateStorageKey(assignmentId, file.fileName);

      const multipartUpload = await this.s3Service.createMultipartUpload({
        Bucket: bucket,
        Key: key,
        ContentType: file.mimeType || "application/octet-stream",
      });

      const uploadId = multipartUpload.UploadId;
      if (!uploadId) {
        throw new BadRequestException("Failed to initiate multipart upload");
      }

      try {
        const partCount = Math.ceil(file.fileSize / partSizeBytes);
        const urls = await Promise.all(
          Array.from({ length: partCount }, async (_, index) => {
            const partNumber = index + 1;
            const url = await this.s3Service.getSignedUrl("uploadPart", {
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
              Expires: expiresInSeconds,
            });
            return { partNumber, url };
          }),
        );

        const created = await this.prisma.assignmentFile.create({
          data: {
            assignmentId,
            filename: file.fileName,
            mimeType: file.mimeType || "application/octet-stream",
            size: file.fileSize,
            storageKey: key,
            storageBucket: bucket,
            status: AssignmentFileStatus.UPLOADING,
            extractionStatus: AssignmentFileExtractionStatus.PENDING,
            uploadId,
          },
        });

        uploads.push({
          fileId: created.id,
          uploadId,
          key,
          bucket,
          partSizeBytes,
          urls,
        });
      } catch (error) {
        // Presign/DB failed after MPU init — release the S3 upload so it does not linger.
        await this.s3Service
          .abortMultipartUpload({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          })
          .catch((abortError: unknown) => {
            const message =
              abortError instanceof Error
                ? abortError.message
                : String(abortError);
            this.logger.warn(
              `initiateAssignmentFileUploads: abort cleanup failed for ${key}: ${message}`,
            );
          });
        throw error;
      }
    }

    this.logger.debug(
      `initiateAssignmentFileUploads: ${dto.files.length} files for assignment ${assignmentId} by user ${userId}`,
    );

    return { uploads };
  }

  async completeAssignmentFileUpload(
    assignmentId: number,
    fileId: number,
    dto: CompleteAssignmentFileDto,
  ): Promise<AssignmentFileResponse> {
    const file = await this.prisma.assignmentFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }
    if (file.assignmentId !== assignmentId) {
      throw new BadRequestException(
        `File ${fileId} does not belong to assignment ${assignmentId}`,
      );
    }
    if (file.status !== AssignmentFileStatus.UPLOADING) {
      throw new BadRequestException(`File ${fileId} is not in UPLOADING state`);
    }
    if (file.uploadId !== dto.uploadId) {
      throw new BadRequestException(`uploadId mismatch for file ${fileId}`);
    }

    await this.s3Service.completeMultipartUpload({
      Bucket: file.storageBucket,
      Key: file.storageKey,
      UploadId: dto.uploadId,
      MultipartUpload: {
        Parts: dto.parts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.etag,
        })),
      },
    });

    const object = await this.s3Service.getObject({
      Bucket: file.storageBucket,
      Key: file.storageKey,
    });
    const buffer = await this.collectBodyToBuffer(object.Body);

    const [extractedFile] =
      await this.fileContentExtractionService.extractContentFromFiles([
        {
          filename: file.filename,
          content: "InCos",
          fileType: file.mimeType || "application/octet-stream",
          bucket: file.storageBucket,
          key: file.storageKey,
          buffer,
        },
      ]);

    const extractionFailed = extractedFile.error !== undefined;
    const safeExtractedText = extractionFailed
      ? null
      : this.sanitizeForTextColumn(extractedFile.content);
    const safeExtractionError = extractionFailed
      ? this.sanitizeForTextColumn(extractedFile.error ?? null)
      : null;

    let updated: AssignmentFile;
    try {
      updated = await this.prisma.assignmentFile.update({
        where: { id: fileId },
        data: {
          status: AssignmentFileStatus.READY,
          extractedText: safeExtractedText,
          extractionStatus: extractionFailed
            ? AssignmentFileExtractionStatus.FAILED
            : AssignmentFileExtractionStatus.READY,
          extractionError: safeExtractionError,
          extractedAt: extractionFailed ? null : new Date(),
          uploadId: null,
        },
      });
    } catch (error) {
      // Extractor output can be unsafe for Postgres TEXT even after sanitization
      // (invalid UTF-8, oversized payloads). Keep the row usable — flip to READY
      // with extractionStatus=FAILED so the file is not permanently stuck in UPLOADING.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `completeAssignmentFileUpload: persisting extraction output failed for file ${fileId}: ${message}`,
      );
      updated = await this.prisma.assignmentFile.update({
        where: { id: fileId },
        data: {
          status: AssignmentFileStatus.READY,
          extractedText: null,
          extractionStatus: AssignmentFileExtractionStatus.FAILED,
          extractionError: "Extraction output rejected by storage layer",
          extractedAt: null,
          uploadId: null,
        },
      });
    }

    return this.toResponse(updated);
  }

  /**
   * Postgres TEXT columns reject null bytes (\u0000) and raise
   * "unexpected end of hex escape" on some malformed byte sequences.
   * Strip those characters and cap length so binary-parse noise from the
   * extractor cannot make the whole transaction unrecoverable.
   */
  private sanitizeForTextColumn(value: string | null): string | null {
    if (value == null) {
      return null;
    }
    const NUL = String.fromCodePoint(0);
    const stripped = value.replaceAll(NUL, "");
    const MAX_LEN = 2_000_000;
    return stripped.length > MAX_LEN ? stripped.slice(0, MAX_LEN) : stripped;
  }

  async abortAssignmentFileUpload(
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
      throw new BadRequestException(
        `File ${fileId} does not belong to assignment ${assignmentId}`,
      );
    }

    if (file.uploadId) {
      try {
        await this.s3Service.abortMultipartUpload({
          Bucket: file.storageBucket,
          Key: file.storageKey,
          UploadId: file.uploadId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `abortAssignmentFileUpload: S3 abort failed for file ${fileId} (uploadId=${file.uploadId}): ${message}`,
        );
      }
    }

    await this.prisma.assignmentFile.delete({ where: { id: fileId } });
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

  private getMultipartPartSizeBytes(): number {
    const configured = Number(
      process.env.MULTIPART_UPLOAD_PART_SIZE_BYTES ?? MIN_PART_SIZE_BYTES,
    );
    if (!Number.isFinite(configured) || configured < MIN_PART_SIZE_BYTES) {
      return MIN_PART_SIZE_BYTES;
    }
    return configured;
  }

  private getPresignedUrlTtlSeconds(): number {
    const fromEnvironment = Number(
      process.env.UPLOAD_PRESIGNED_URL_TTL_SECONDS ??
        DEFAULT_PRESIGNED_URL_TTL_SECONDS,
    );
    if (!Number.isFinite(fromEnvironment) || fromEnvironment <= 0) {
      return DEFAULT_PRESIGNED_URL_TTL_SECONDS;
    }
    return Math.min(fromEnvironment, MAX_PRESIGNED_URL_TTL_SECONDS);
  }

  private async collectBodyToBuffer(body: unknown): Promise<Buffer> {
    if (!body) {
      return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(body)) {
      return body;
    }
    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    const chunks: Buffer[] = [];
    const stream = body as NodeJS.ReadableStream;

    return new Promise<Buffer>((resolve, reject) => {
      stream.on("data", (chunk: unknown) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (chunk instanceof Uint8Array) {
          chunks.push(Buffer.from(chunk));
        } else if (typeof chunk === "string") {
          chunks.push(Buffer.from(chunk));
        }
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
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
