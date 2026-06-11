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
import { OversizedSubmissionError } from "src/api/llm/features/grading/errors/oversized-submission.error";
import { UploadType } from "src/api/files/dto/upload.dto";
import { FilesService } from "src/api/files/services/files.service";
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
    private readonly filesService: FilesService,
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
      // Cap file size before deriving partCount from it — the DTO only checks
      // @IsPositive, so without this a client could request hundreds of
      // thousands of presigned URLs in one call.
      this.filesService.validateUploadSize(
        file.fileSize,
        UploadType.AUTHOR,
        file.fileName,
      );

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

    try {
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
    } catch (completeError) {
      const message =
        completeError instanceof Error
          ? completeError.message
          : String(completeError);
      this.logger.error(
        `completeAssignmentFileUpload: S3 complete failed for fileId=${fileId}: ${message}`,
      );

      let objectExists = false;
      try {
        objectExists = await this.s3Service.objectExists(
          file.storageBucket,
          file.storageKey,
        );
      } catch (existsError) {
        const existsMessage =
          existsError instanceof Error
            ? existsError.message
            : String(existsError);
        this.logger.warn(
          `completeAssignmentFileUpload: object existence check failed for fileId=${fileId}: ${existsMessage}`,
        );
      }

      if (!objectExists) {
        await this.s3Service
          .abortMultipartUpload({
            Bucket: file.storageBucket,
            Key: file.storageKey,
            UploadId: dto.uploadId,
          })
          .catch((abortError: unknown) => {
            const abortMessage =
              abortError instanceof Error
                ? abortError.message
                : String(abortError);
            this.logger.warn(
              `completeAssignmentFileUpload: S3 abort after complete failure also failed for fileId=${fileId}: ${abortMessage}`,
            );
          });
        await this.markAssignmentFileFailed(
          fileId,
          `Multipart upload completion failed: ${message}`,
        );
        throw completeError;
      }

      this.logger.warn(
        `completeAssignmentFileUpload: completeMultipartUpload threw for fileId=${fileId}, but object exists so continuing`,
      );
    }

    let extractedFile: Awaited<
      ReturnType<
        typeof this.fileContentExtractionService.extractContentFromFiles
      >
    >[number];

    try {
      const object = await this.s3Service.getObject({
        Bucket: file.storageBucket,
        Key: file.storageKey,
      });
      const buffer = await this.collectBodyToBuffer(object.Body);
      const extractionInput = [
        {
          filename: file.filename,
          content: "InCos",
          fileType: file.mimeType || "application/octet-stream",
          bucket: file.storageBucket,
          key: file.storageKey,
          buffer,
        },
      ];

      try {
        [extractedFile] =
          await this.fileContentExtractionService.extractContentFromFiles(
            extractionInput,
          );
      } catch (error) {
        if (!(error instanceof OversizedSubmissionError)) {
          throw error;
        }
        // Author reference material is context, not graded work: an over-cap
        // PDF should degrade to truncated simple extraction (pre-existing
        // behavior) rather than fail the upload. The evidence-block cap is a
        // grading concern that does not apply here.
        this.logger.warn(
          `completeAssignmentFileUpload: oversized reference file ${file.filename} (blockCount=${error.blockCount} cap=${error.cap}); retrying with structured extraction disabled`,
        );
        [extractedFile] =
          await this.fileContentExtractionService.extractContentFromFiles(
            extractionInput,
            { useStructuredExtraction: false },
          );
      }
    } catch (extractionError) {
      const message =
        extractionError instanceof Error
          ? extractionError.message
          : String(extractionError);
      this.logger.error(
        `completeAssignmentFileUpload: post-complete step failed for fileId=${fileId}: ${message}`,
      );
      extractedFile = {
        filename: file.filename,
        content: "",
        error: `Post-upload extraction failed: ${message}`,
        fileType: file.mimeType || "application/octet-stream",
        metadata: { size: file.size },
      };
    }

    if (!extractedFile) {
      extractedFile = {
        filename: file.filename,
        content: "",
        error: "File content extraction returned no result",
        fileType: file.mimeType || "application/octet-stream",
        metadata: { size: file.size },
      };
    }

    const extractionFailed = extractedFile.error !== undefined;
    const safeExtractedText = extractionFailed
      ? null
      : this.sanitizeForTextColumn(extractedFile.content);
    const safeExtractionError = extractionFailed
      ? this.sanitizeForTextColumn(extractedFile.error ?? null)
      : null;
    const extractedLength = safeExtractedText?.length ?? 0;
    const errorLength = safeExtractionError?.length ?? 0;
    this.logger.log(
      `completeAssignmentFileUpload: fileId=${fileId} extractionFailed=${String(extractionFailed)} extractedLen=${extractedLength} errorLen=${errorLength}`,
    );

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
      this.logger.log(
        `completeAssignmentFileUpload: fileId=${fileId} primary update OK status=READY`,
      );
    } catch (error) {
      // Extractor output can be unsafe for Postgres TEXT even after sanitization
      // (Prisma query engine rejects malformed UTF-8 / truncated \u escapes with
      // "unexpected end of hex escape"). Fall back to storing a fixed-ASCII
      // error marker via $executeRaw — that bypasses the query engine's JSON
      // boundary so it cannot fail on extractor output. Keep the row usable.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `completeAssignmentFileUpload: primary update failed for fileId=${fileId}: ${message}`,
      );
      try {
        await this.prisma.$executeRaw`
          UPDATE "AssignmentFile"
          SET "status" = 'READY'::"AssignmentFileStatus",
              "extractedText" = NULL,
              "extractionStatus" = 'FAILED'::"AssignmentFileExtractionStatus",
              "extractionError" = 'Extraction output rejected by storage layer',
              "extractedAt" = NULL,
              "uploadId" = NULL,
              "updatedAt" = NOW()
          WHERE "id" = ${fileId}
        `;
        this.logger.log(
          `completeAssignmentFileUpload: fileId=${fileId} fallback raw update OK status=READY/FAILED`,
        );
      } catch (fallbackError) {
        const fm =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        this.logger.error(
          `completeAssignmentFileUpload: FALLBACK update ALSO failed for fileId=${fileId}: ${fm}`,
        );
        throw fallbackError;
      }
      const reloaded = await this.prisma.assignmentFile.findUnique({
        where: { id: fileId },
      });
      if (!reloaded) {
        throw new NotFoundException(
          `File with ID ${fileId} not found after fallback update`,
        );
      }
      updated = reloaded;
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
    const noNul = value.replaceAll(NUL, "");
    // UTF-8 round-trip replaces malformed / lone-surrogate sequences with
    // U+FFFD, avoiding Prisma query-engine "unexpected end of hex escape".
    const utf8Safe = Buffer.from(noNul, "utf8").toString("utf8");
    const MAX_LEN = 2_000_000;
    return utf8Safe.length > MAX_LEN ? utf8Safe.slice(0, MAX_LEN) : utf8Safe;
  }

  private async markAssignmentFileFailed(
    fileId: number,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.assignmentFile
      .update({
        where: { id: fileId },
        data: {
          status: AssignmentFileStatus.FAILED,
          extractedText: null,
          extractionStatus: AssignmentFileExtractionStatus.FAILED,
          extractionError: this.sanitizeForTextColumn(errorMessage),
          extractedAt: null,
          uploadId: null,
        },
      })
      .catch((databaseError: unknown) => {
        const message =
          databaseError instanceof Error
            ? databaseError.message
            : String(databaseError);
        this.logger.error(
          `markAssignmentFileFailed: failed to update fileId=${fileId}: ${message}`,
        );
      });
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
    if (file.status !== AssignmentFileStatus.UPLOADING) {
      throw new BadRequestException(
        `File ${fileId} is not in UPLOADING state and cannot be aborted`,
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

  async cleanupOrphanedUploadingFiles(
    thresholdMinutes = 60,
  ): Promise<{ cleaned: number }> {
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const orphaned = await this.prisma.assignmentFile.findMany({
      where: {
        status: AssignmentFileStatus.UPLOADING,
        createdAt: { lt: cutoff },
      },
    });

    if (orphaned.length === 0) {
      return { cleaned: 0 };
    }

    this.logger.log(
      `cleanupOrphanedUploadingFiles: found ${orphaned.length} stale UPLOADING rows (threshold=${thresholdMinutes}m)`,
    );

    await Promise.allSettled(
      orphaned
        .filter((f) => f.uploadId)
        .map((f) =>
          this.s3Service
            .abortMultipartUpload({
              Bucket: f.storageBucket,
              Key: f.storageKey,
              UploadId: f.uploadId,
            })
            .catch((error: unknown) => {
              const message =
                error instanceof Error ? error.message : String(error);
              this.logger.warn(
                `cleanupOrphanedUploadingFiles: S3 abort failed for file ${f.id} (key=${f.storageKey}): ${message}`,
              );
            }),
        ),
    );

    // Re-check status in the WHERE clause to avoid deleting a row that completed
    // between the findMany and deleteMany (TOCTOU guard).
    const { count } = await this.prisma.assignmentFile.deleteMany({
      where: {
        id: { in: orphaned.map((f) => f.id) },
        status: AssignmentFileStatus.UPLOADING,
      },
    });

    this.logger.log(
      `cleanupOrphanedUploadingFiles: deleted ${count} orphaned UPLOADING records`,
    );
    return { cleaned: count };
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
