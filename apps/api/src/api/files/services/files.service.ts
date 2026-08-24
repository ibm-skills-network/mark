import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/database/prisma.service";
import { CreateFolderDto } from "../dto/create-folder.dto";
import {
  FileMetadataDto,
  FileResponseDto,
  FolderListingDto,
} from "../dto/file-metadata.dto";
import { MoveFileDto } from "../dto/move-file.dto";
import { RenameFileDto } from "../dto/rename-file.dto";
import {
  AbortMultipartUploadRequestDto,
  CompleteMultipartUploadRequestDto,
  CompleteMultipartUploadResponseDto,
  MultipartUploadInitiateResponseDto,
  UploadContextDto,
  UploadRequestDto,
  UploadResponseDto,
  UploadType,
} from "../dto/upload.dto";
import { FileProcessingBudgetService } from "./file-processing-budget.service";
import { sanitizeUploadPath } from "./path-sanitizer";
import { S3Service } from "./s3.service";

const CHATBOT_ALLOWED_FILE_TYPES: Record<string, string[]> = {
  "text/plain": [
    ".txt",
    ".md",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".css",
    ".html",
    ".sql",
    ".sh",
  ],
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    ".pptx",
  ],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.ms-excel": [".xls"],
  "application/x-ipynb+json": [".ipynb"],
  "text/javascript": [".js"],
  "application/javascript": [".js"],
  "application/typescript": [".ts", ".tsx"],
  "text/typescript": [".ts", ".tsx"],
  "video/mp2t": [".ts"],
  "text/x-python": [".py"],
  "application/x-python": [".py"],
  "text/x-python-script": [".py"],
  "text/html": [".html"],
  "text/css": [".css"],
  "application/sql": [".sql"],
  "text/x-sql": [".sql"],
  "application/x-sh": [".sh"],
  "text/x-sh": [".sh"],
  "application/x-shellscript": [".sh"],
};

const CHATBOT_ALLOWED_EXTENSIONS = new Set(
  Object.values(CHATBOT_ALLOWED_FILE_TYPES).flat(),
);

/** Narrow untrusted JSON to a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private s3Service: S3Service,
    private prisma: PrismaService,
    private processingBudget: FileProcessingBudgetService,
  ) {}

  /**
   * In-process map of uploadId -> { bytes, expiry timer } claimed against the
   * byte-budget at /initiate time. /complete and /abort release the exact same
   * amount. If the client abandons (refresh, network drop) and never sends
   * either, the timer auto-releases after BUDGET_CLAIM_TTL_MS so abandoned
   * uploads don't pin budget for the pod's lifetime. Pod restart still drops
   * the whole map as a backstop.
   */
  private readonly budgetClaims = new Map<
    string,
    { bytes: number; timer: NodeJS.Timeout }
  >();

  private static readonly BUDGET_CLAIM_TTL_MS = 10 * 60 * 1000;

  /**
   * Get the appropriate bucket name based on environment and upload type
   */
  getBucketForEnvironment(
    uploadType: UploadType,
    isProduction = false,
  ): string {
    if (uploadType === UploadType.LEARNER && isProduction) {
      return this.s3Service.getBucketName(UploadType.LEARNER_PROD);
    }
    return this.s3Service.getBucketName(uploadType);
  }

  /**
   * Determine if a bucket is in the production environment (us-south)
   */
  isProductionBucket(bucket: string): boolean {
    return bucket === process.env.IBM_COS_LEARNER_BUCKET_PROD;
  }

  /**
   * Get bucket region information
   */
  getBucketInfo(bucket: string): { region: string; isProduction: boolean } {
    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      region: this.s3Service.getBucketRegion(bucket),
      isProduction: this.isProductionBucket(bucket),
    };
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return now.toLocaleString("default", { month: "long" }).toLowerCase();
  }

  private generateUniqueId(): string {
    // could be replaced with a more robust solution like UUID
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  private getPresignedUploadTtlSeconds(): number {
    const defaultTtl = 600;
    const maxTtl = 900;
    const fromEnvironment = Number(
      process.env.UPLOAD_PRESIGNED_URL_TTL_SECONDS ?? defaultTtl,
    );
    if (!Number.isFinite(fromEnvironment) || fromEnvironment <= 0) {
      return defaultTtl;
    }
    return Math.min(fromEnvironment, maxTtl);
  }

  private getMultipartPartSizeBytes(): number {
    const minimumPartSize = 5 * 1024 * 1024;
    const configured = Number(
      process.env.MULTIPART_UPLOAD_PART_SIZE_BYTES ?? minimumPartSize,
    );

    if (!Number.isFinite(configured) || configured < minimumPartSize) {
      return minimumPartSize;
    }

    return configured;
  }

  resolveUploadTarget(
    uploadRequest: UploadRequestDto,
    userId: string,
    role: UserRole,
  ): {
    bucket: string;
    key: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    uploadType: UploadType;
    maxAllowedBytes: number;
  } {
    const { fileName, fileType, fileSize, uploadType } = uploadRequest;

    // `context` reaches us as untyped JSON on both upload paths, so null,
    // arrays and primitives all get here. A destructuring default only covers
    // undefined — anything else used to reach property access and 500.
    const context: UploadContextDto = isPlainObject(uploadRequest.context)
      ? uploadRequest.context
      : {};

    this.assertRoleAllowedForUploadType(role, uploadType, userId);

    const bucket = this.s3Service.getBucketName(uploadType);
    if (!bucket) {
      throw new BadRequestException("Invalid upload type");
    }

    const maxAllowedBytes = this.validateUploadSize(
      fileSize,
      uploadType,
      fileName,
    );
    this.validateUploadType(uploadType, fileType, fileName);

    let prefix = "";
    const normalizedPath = sanitizeUploadPath(context.path);

    switch (uploadType) {
      case UploadType.AUTHOR: {
        prefix = normalizedPath ? `${normalizedPath}/` : `authors/${userId}/`;
        break;
      }

      case UploadType.LEARNER: {
        if (typeof context.assignmentId !== "number") {
          throw new BadRequestException(
            "Missing assignmentId in context for learner upload",
          );
        }
        if (typeof context.questionId !== "number") {
          throw new BadRequestException(
            "Missing questionId in context for learner upload",
          );
        }

        prefix = `${context.assignmentId}/${userId}/${context.questionId}/`;
        break;
      }

      case UploadType.LEARNER_PROD: {
        if (typeof context.assignmentId !== "number") {
          throw new BadRequestException(
            "Missing assignmentId in context for learner production upload",
          );
        }
        if (typeof context.questionId !== "number") {
          throw new BadRequestException(
            "Missing questionId in context for learner production upload",
          );
        }

        prefix = `${context.assignmentId}/${userId}/${context.questionId}/`;
        break;
      }

      case UploadType.CHATBOT: {
        prefix = `chatbot/${userId}/`;
        break;
      }

      case UploadType.DEBUG: {
        if (typeof context.reportId !== "number") {
          throw new BadRequestException(
            "Missing reportId in context for debug upload",
          );
        }
        prefix = normalizedPath
          ? `${normalizedPath}/`
          : `debug/${context.reportId}/`;
        break;
      }

      default: {
        throw new BadRequestException("Invalid upload type");
      }
    }

    const uniqueId = this.generateUniqueId();
    const key = `${prefix}${uniqueId}-${fileName}`;

    return {
      bucket,
      key,
      fileName,
      fileType,
      fileSize,
      uploadType,
      maxAllowedBytes,
    };
  }

  private assertRoleAllowedForUploadType(
    role: UserRole,
    uploadType: UploadType,
    userId: string,
  ): void {
    const isAdmin = role === UserRole.ADMIN;
    const isAuthor = role === UserRole.AUTHOR;
    const isLearner = role === UserRole.LEARNER;

    const denied = (): never => {
      this.logger.warn(
        `Upload type rejected by role guard: uploadType=${uploadType} role=${role} user=${userId}`,
      );
      throw new ForbiddenException();
    };

    switch (uploadType) {
      case UploadType.AUTHOR: {
        if (!isAuthor && !isAdmin) denied();
        return;
      }
      case UploadType.LEARNER:
      case UploadType.LEARNER_PROD: {
        if (!isLearner && !isAdmin) denied();
        return;
      }
      case UploadType.CHATBOT: {
        // Chatbot keys are user-scoped (chatbot/<userId>/...). Both authors
        // (testing the chat) and learners (using it) need to attach files.
        if (!isAuthor && !isLearner && !isAdmin) denied();
        return;
      }
      case UploadType.DEBUG: {
        if (!isAdmin) denied();
        return;
      }
      default: {
        denied();
      }
    }
  }

  private getMaxUploadBytes(uploadType: UploadType): number {
    const fallback = 100 * 1024 * 1024;

    const perTypeEnvironment: Record<UploadType, string | undefined> = {
      [UploadType.AUTHOR]: process.env.AUTHOR_UPLOAD_MAX_BYTES,
      [UploadType.LEARNER]: process.env.LEARNER_UPLOAD_MAX_BYTES,
      [UploadType.LEARNER_PROD]: process.env.LEARNER_UPLOAD_MAX_BYTES,
      [UploadType.DEBUG]: process.env.DEBUG_UPLOAD_MAX_BYTES,
      [UploadType.CHATBOT]: process.env.LEARNER_UPLOAD_MAX_BYTES,
    };

    const globalEnvironment = process.env.UPLOAD_MAX_BYTES;
    const chosen = perTypeEnvironment[uploadType] ?? globalEnvironment;
    const parsed = Number(chosen ?? fallback);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  validateUploadSize(
    fileSize: number,
    uploadType: UploadType,
    fileName: string,
  ): number {
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      throw new BadRequestException("fileSize must be a positive number.");
    }

    const maxAllowedBytes = this.getMaxUploadBytes(uploadType);
    if (fileSize > maxAllowedBytes) {
      this.logger.warn(
        `Upload rejected by size limit: uploadType=${uploadType} file=${fileName} size=${fileSize} max=${maxAllowedBytes}`,
      );
      throw new BadRequestException(
        `File is too large. Max allowed is ${maxAllowedBytes} bytes.`,
      );
    }

    return maxAllowedBytes;
  }

  private validateChatbotUploadType(fileType: string, fileName: string): void {
    const normalizedFileType = fileType.trim().toLowerCase();
    const extension = fileName.includes(".")
      ? `.${fileName.split(".").pop()?.toLowerCase() || ""}`
      : "";

    if (!extension || !CHATBOT_ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        "Unsupported file extension for chatbot upload.",
      );
    }

    if (!normalizedFileType) {
      return;
    }

    const allowedExtensions = CHATBOT_ALLOWED_FILE_TYPES[normalizedFileType];
    if (!allowedExtensions) {
      throw new BadRequestException("Unsupported mimeType for chatbot upload.");
    }

    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestException(
        "File extension does not match the provided MIME type for chatbot upload.",
      );
    }
  }

  private validateUploadType(
    uploadType: UploadType,
    fileType: string,
    fileName: string,
  ): void {
    if (uploadType === UploadType.CHATBOT) {
      this.validateChatbotUploadType(fileType, fileName);
    }
  }

  private monitorUploadRequest(parameters: {
    uploadType: UploadType;
    fileName: string;
    fileSize: number;
    maxAllowedBytes: number;
    bucket: string;
    key: string;
    expiresInSeconds: number;
    userId: string;
  }): void {
    const ratio = parameters.fileSize / parameters.maxAllowedBytes;
    const percentage = Math.round(ratio * 100);
    const levelPrefix =
      ratio >= 0.9 ? "near-limit" : ratio >= 0.75 ? "high-usage" : "normal";

    const message =
      `Upload request [${levelPrefix}] user=${parameters.userId} ` +
      `type=${parameters.uploadType} file=${parameters.fileName} size=${parameters.fileSize} ` +
      `limit=${parameters.maxAllowedBytes} bucket=${parameters.bucket} key=${parameters.key} ` +
      `ttl=${parameters.expiresInSeconds}s usage=${percentage}%`;

    if (ratio >= 0.9) {
      this.logger.warn(message);
      return;
    }

    this.logger.log(message);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async generateUploadUrl(
    uploadRequest: UploadRequestDto,
    userId: string,
    role: UserRole,
  ): Promise<UploadResponseDto> {
    const {
      bucket,
      key,
      fileName,
      fileType,
      fileSize,
      uploadType,
      maxAllowedBytes,
    } = this.resolveUploadTarget(uploadRequest, userId, role);
    const expiresInSeconds = this.getPresignedUploadTtlSeconds();

    const presignedUrl = await this.s3Service.getSignedUrl("putObject", {
      Bucket: bucket,
      Key: key,
      ContentType: fileType,
      Expires: expiresInSeconds,
      ContentLength: fileSize,
    });

    this.monitorUploadRequest({
      uploadType,
      fileName,
      fileSize,
      maxAllowedBytes,
      bucket,
      key,
      expiresInSeconds,
      userId,
    });

    return {
      presignedUrl,
      key,
      bucket,
      fileType,
      fileName,
      uploadType,
      expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      maxAllowedBytes,
    };
  }

  async initiateMultipartUpload(
    uploadRequest: UploadRequestDto,
    userId: string,
    role: UserRole,
  ): Promise<MultipartUploadInitiateResponseDto> {
    const {
      bucket,
      key,
      fileName,
      fileType,
      fileSize,
      uploadType,
      maxAllowedBytes,
    } = this.resolveUploadTarget(uploadRequest, userId, role);
    const expiresInSeconds = this.getPresignedUploadTtlSeconds();
    const partSizeBytes = this.getMultipartPartSizeBytes();
    // Number of parts = file size divided by part size, rounded up
    const partCount = Math.ceil(fileSize / partSizeBytes);

    // Register the multipart upload with S3 to get an uploadId
    const multipartUpload = await this.s3Service.createMultipartUpload({
      Bucket: bucket,
      Key: key,
      ContentType: fileType,
    });

    const uploadId = multipartUpload.UploadId;
    if (!uploadId) {
      throw new BadRequestException("Failed to initiate multipart upload");
    }

    // Admission control: reserve fileSize against the pod-wide processing
    // budget so concurrent oversized uploads queue gracefully on the client
    // ("Waiting to upload…") rather than racing toward OOM. Failing fast here
    // lets the client retry explicitly with retryAfterMs.
    if (!this.processingBudget.tryAcquire(fileSize)) {
      this.logger.warn(
        `Upload admission deferred — budget full: user=${userId} ` +
          `type=${uploadType} size=${fileSize}`,
      );
      // Roll back the S3 multipart we just opened so we don't leak partial
      // sessions while the client backs off.
      try {
        await this.s3Service.abortMultipartUpload({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        });
      } catch (abortError) {
        this.logger.warn(
          `Failed to abort S3 multipart after budget rejection: ` +
            (abortError instanceof Error
              ? abortError.message
              : String(abortError)),
        );
      }
      throw this.processingBudget.buildBusyException(fileSize);
    }
    const expiryTimer = setTimeout(() => {
      const entry = this.budgetClaims.get(uploadId);
      if (!entry) return;
      this.budgetClaims.delete(uploadId);
      this.processingBudget.release(entry.bytes);
      const { inflight, budget } = this.processingBudget.getStatus();
      this.logger.warn(
        `Budget claim auto-released after ${FilesService.BUDGET_CLAIM_TTL_MS}ms ` +
          `with no /complete or /abort: uploadId=${uploadId} bytes=${entry.bytes} ` +
          `inflight=${inflight}/${budget} claims=${this.budgetClaims.size}`,
      );
      void this.markUploadStatus(uploadId, "ABORTED").catch((error) => {
        this.logger.warn(
          `Failed to mark abandoned upload ABORTED: uploadId=${uploadId} ` +
            (error instanceof Error ? error.message : String(error)),
        );
      });
    }, FilesService.BUDGET_CLAIM_TTL_MS);
    // Node keeps the event loop alive on pending timers; unref so a quiet
    // process can still exit instead of waiting out the TTL.
    expiryTimer.unref?.();
    this.budgetClaims.set(uploadId, { bytes: fileSize, timer: expiryTimer });

    // Persist an ownership record so /complete and /abort can authorize
    // the caller against the uploadId+key without trusting the request body.
    await this.prisma.fileUpload.create({
      data: {
        userId,
        uploadId,
        storageKey: key,
        bucket,
        uploadType,
        sizeBytes: BigInt(fileSize),
        status: "PENDING",
      },
    });

    // Generate one presigned URL per part so the client can PUT directly to S3
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

        return {
          partNumber,
          url,
        };
      }),
    );

    this.monitorUploadRequest({
      uploadType,
      fileName,
      fileSize,
      maxAllowedBytes,
      bucket,
      key,
      expiresInSeconds,
      userId,
    });

    return {
      uploadId,
      key,
      bucket,
      fileType,
      fileName,
      uploadType,
      expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      maxAllowedBytes,
      partSizeBytes,
      urls,
    };
  }

  async completeMultipartUpload(
    request: CompleteMultipartUploadRequestDto,
    userId: string,
  ): Promise<CompleteMultipartUploadResponseDto> {
    const bucket = this.s3Service.getBucketName(request.uploadType);
    if (!bucket) {
      throw new BadRequestException("Invalid upload type");
    }

    if (!request.parts?.length) {
      throw new BadRequestException(
        "At least one multipart upload part is required",
      );
    }

    await this.assertUploadOwnership(userId, {
      uploadId: request.uploadId,
      storageKey: request.key,
      bucket,
    });

    // Tell S3 to assemble the parts into the final object using the collected ETags
    const result = await this.s3Service.completeMultipartUpload({
      Bucket: bucket,
      Key: request.key,
      UploadId: request.uploadId,
      MultipartUpload: {
        Parts: request.parts.map((part) => ({
          ETag: part.etag,
          PartNumber: part.partNumber,
        })),
      },
    });

    const maxAllowedBytes = this.getMaxUploadBytes(request.uploadType);
    const head = await this.s3Service.headObject({
      Bucket: bucket,
      Key: request.key,
    });
    const actualSize =
      typeof head.ContentLength === "number" ? head.ContentLength : 0;

    if (actualSize > maxAllowedBytes) {
      this.logger.warn(
        `Multipart complete exceeded size cap: uploadType=${request.uploadType} ` +
          `key=${request.key} actual=${actualSize} max=${maxAllowedBytes}`,
      );
      try {
        await this.s3Service.deleteObject({
          Bucket: bucket,
          Key: request.key,
        });
      } catch (deleteError) {
        this.logger.error(
          `Failed to delete oversized multipart object key=${request.key}: ` +
            (deleteError instanceof Error
              ? deleteError.message
              : String(deleteError)),
        );
      }
      await this.markUploadStatus(request.uploadId, "ABORTED");
      this.releaseBudgetClaim(request.uploadId);
      throw new BadRequestException(
        `File is too large. Max allowed is ${maxAllowedBytes} bytes.`,
      );
    }

    await this.markUploadStatus(request.uploadId, "COMPLETED");
    this.releaseBudgetClaim(request.uploadId);

    return {
      success: true,
      key: request.key,
      bucket,
      uploadId: request.uploadId,
      etag: typeof result.ETag === "string" ? result.ETag : undefined,
    };
  }

  async abortMultipartUpload(
    request: AbortMultipartUploadRequestDto,
    userId: string,
  ): Promise<void> {
    const bucket = this.s3Service.getBucketName(request.uploadType);
    if (!bucket) {
      throw new BadRequestException("Invalid upload type");
    }

    await this.assertUploadOwnership(userId, {
      uploadId: request.uploadId,
      storageKey: request.key,
      bucket,
    });

    await this.s3Service.abortMultipartUpload({
      Bucket: bucket,
      Key: request.key,
      UploadId: request.uploadId,
    });

    await this.markUploadStatus(request.uploadId, "ABORTED");
    this.releaseBudgetClaim(request.uploadId);
  }

  private releaseBudgetClaim(uploadId: string): void {
    const claim = this.budgetClaims.get(uploadId);
    if (!claim) return;
    clearTimeout(claim.timer);
    this.budgetClaims.delete(uploadId);
    this.processingBudget.release(claim.bytes);
  }

  // COMPLETED and ABORTED rows are retained for audit and for the cluster-wide
  // pending-bytes aggregate. They are never deleted automatically. For the
  // current upload volume this is acceptable; add a periodic sweep if row
  // count becomes a concern.
  private async markUploadStatus(
    uploadId: string,
    status: "COMPLETED" | "ABORTED",
  ): Promise<void> {
    await this.prisma.fileUpload.updateMany({
      where: { uploadId, status: "PENDING" },
      data: { status, completedAt: new Date() },
    });
  }

  getProcessingBudgetStatus(): {
    budget: number;
    inflight: number;
    waiters: number;
  } {
    return this.processingBudget.getStatus();
  }

  /**
   * Pod-local count of outstanding budget claims. Used by the admin status
   * endpoint. Note: the total claimed bytes always equals pod.inflight from
   * getProcessingBudgetStatus() because both counters are updated together
   * in registerBudgetClaim / releaseBudgetClaim.
   */
  getBudgetClaimsSnapshot(): { count: number } {
    return { count: this.budgetClaims.size };
  }

  /**
   * Cluster-wide pending-upload aggregation. Sums sizeBytes for FileUpload
   * rows still marked PENDING — accurate across all pods, unlike the
   * in-memory budget counters which are per-replica.
   */
  async getPendingUploadAggregate(): Promise<{
    count: number;
    totalBytes: number;
  }> {
    const result = await this.prisma.fileUpload.aggregate({
      where: { status: "PENDING" },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
    const sum = result._sum.sizeBytes;
    return {
      count: result._count._all,
      totalBytes: sum == null ? 0 : Number(sum),
    };
  }

  private async assertUploadOwnership(
    userId: string,
    expected: { uploadId: string; storageKey: string; bucket: string },
  ): Promise<void> {
    const row = await this.prisma.fileUpload.findUnique({
      where: { uploadId: expected.uploadId },
    });
    if (
      !row ||
      row.userId !== userId ||
      row.storageKey !== expected.storageKey ||
      row.bucket !== expected.bucket
    ) {
      this.logger.warn(
        `Upload ownership check failed: uploadId=${expected.uploadId} user=${userId}`,
      );
      throw new NotFoundException();
    }
  }

  async generatePublicUrl(key: string): Promise<{ presignedUrl: string }> {
    const bucket = process.env.S3_PUBLIC_BUCKET;

    const presignedUrl = await this.s3Service.getSignedUrl("getObject", {
      Bucket: bucket,
      Key: key,
      Expires: 3600,
    });

    return { presignedUrl };
  }

  /**
   * Stream a buffered upload into object storage.
   *
   * Claims the file's size against the pod byte-budget for the duration of
   * the PUT, the same accounting the multipart path uses, so a burst of
   * fallback traffic queues on the client instead of racing toward OOM.
   *
   * The claim is taken here rather than at admission because multer has
   * already materialised the whole body in memory by the time any handler
   * runs — this bounds the concurrent storage work, not the buffering itself.
   */
  async directUpload(
    file: Express.Multer.File,
    bucket: string,
    key: string,
  ): Promise<{ success: true; key: string; bucket: string; etag?: string }> {
    if (!this.processingBudget.tryAcquire(file.size)) {
      this.logger.warn(
        `Direct upload deferred — budget full: size=${file.size} ` +
          `bucket=${bucket}`,
      );
      throw this.processingBudget.buildBusyException(file.size);
    }

    try {
      const result = await this.s3Service.putObject({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      return {
        success: true,
        key,
        bucket,
        etag: result.ETag,
      };
    } finally {
      this.processingBudget.release(file.size);
    }
  }

  async createFolder(createFolderDto: CreateFolderDto): Promise<any> {
    const { name, path, uploadType } = createFolderDto;

    if (path !== "/" && !path.startsWith("/")) {
      throw new BadRequestException("Path must start with /");
    }

    const bucket = this.s3Service.getBucketName(uploadType);
    if (!bucket) {
      throw new BadRequestException("Invalid upload type");
    }

    const folderKey = path === "/" ? `${name}/` : `${path.slice(1)}/${name}/`;

    await this.s3Service.putObject({
      Bucket: bucket,
      Key: folderKey,
      Body: "",
    });

    return {
      success: true,
      folder: {
        name,
        path: `/${folderKey.slice(0, -1)}`,
      },
    };
  }

  async deleteFile(uploadType: string, key: string): Promise<any> {
    const bucket = this.s3Service.getBucketName(uploadType);
    if (!bucket) {
      throw new BadRequestException("Invalid upload type");
    }

    await this.s3Service.deleteObject({
      Bucket: bucket,
      Key: key,
    });

    return {
      success: true,
      message: "File deleted successfully",
    };
  }

  async deleteFolder(uploadType: string, folderPath: string): Promise<any> {
    if (folderPath === "/") {
      throw new BadRequestException("Cannot delete the root folder");
    }

    const bucket = this.s3Service.getBucketName(uploadType);
    if (!bucket) {
      throw new BadRequestException("Invalid upload type");
    }

    const folderPrefix = `${folderPath.slice(1)}/`;

    const listedObjects = await this.s3Service.listObjectsV2({
      Bucket: bucket,
      Prefix: folderPrefix,
    });

    if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
      throw new NotFoundException("Folder is empty or does not exist");
    }

    const deleteParameters = {
      Bucket: bucket,
      Delete: {
        Objects: listedObjects.Contents.filter(
          (object): object is { Key: string } => typeof object.Key === "string",
        ).map((object) => ({ Key: object.Key })),
        Quiet: false,
      },
    };

    const deleteResult = await this.s3Service.deleteObjects(deleteParameters);

    if (deleteResult.Errors && deleteResult.Errors.length > 0) {
      return {
        partial: true,
        message: "Some files could not be deleted",
        deleted: deleteResult.Deleted?.length ?? 0,
        errors: deleteResult.Errors.length,
        details: deleteResult.Errors,
      };
    }

    return {
      success: true,
      message: "Folder and all its contents deleted successfully",
      deletedCount: deleteResult.Deleted?.length ?? 0,
    };
  }

  async listEmptyFolders(
    uploadType: string,
    groupId?: string,
  ): Promise<string[]> {
    const bucket = this.s3Service.getBucketName(uploadType);
    if (!bucket) {
      throw new BadRequestException("Invalid upload type");
    }

    const prefix =
      groupId && uploadType === "author" ? `group-${groupId}/` : "";

    const response = await this.s3Service.listObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: "/",
    });

    const folders: string[] = [];

    if (response.CommonPrefixes)
      for (const prefixObject of response.CommonPrefixes) {
        if (prefixObject.Prefix) {
          const folderPath = `/${prefixObject.Prefix.slice(0, -1)}`;
          folders.push(folderPath);
        }
      }

    if (response.Contents)
      for (const item of response.Contents) {
        if (item.Key?.endsWith("/") && item.Size === 0) {
          folders.push(`/${item.Key.slice(0, -1)}`);
        }
      }

    return [...new Set(folders)];
  }

  async getFileAccess(
    uploadType: string,
    fileId?: string,
    key?: string,
  ): Promise<any> {
    let fileData: FileMetadataDto | null;

    if (key) {
      const bucket = this.s3Service.getBucketName(uploadType);
      if (!bucket) {
        throw new BadRequestException("Invalid upload type");
      }

      const fileName = key.split("/").pop() || "file";
      const fileType = fileName.includes(".")
        ? fileName.split(".").pop()?.toLowerCase() || "txt"
        : "txt";

      fileData = {
        cosKey: key,
        cosBucket: bucket,
        fileName,
        fileType,
        contentType: "application/octet-stream",
      };
    }

    if (!fileData?.cosKey || !fileData.cosBucket) {
      throw new NotFoundException("File not found or access denied");
    }

    if (fileData.cosKey.endsWith("/")) {
      const listResult = await this.s3Service.listObjectsV2({
        Bucket: fileData.cosBucket,
        Prefix: fileData.cosKey,
        Delimiter: "/",
      });

      const folderListing: FolderListingDto = {
        folder: fileData.cosKey,
        files:
          listResult.Contents?.map((item) => ({
            key: item.Key,
            size: item.Size,
            lastModified: item.LastModified,
          })) ?? [],
        subfolders:
          listResult.CommonPrefixes?.map((prefix) => prefix.Prefix ?? "") ?? [],
      };

      return folderListing;
    }

    const presignedUrl = await this.s3Service.getSignedUrl("getObject", {
      Bucket: fileData.cosBucket,
      Key: fileData.cosKey,
      Expires: 3600,
    });

    return {
      presignedUrl,
      fileName: fileData.fileName,
      fileType: fileData.fileType,
      contentType: fileData.contentType ?? "application/octet-stream",
    };
  }

  async listFiles(uploadType: string): Promise<FileResponseDto[]> {
    const bucket = this.s3Service.getBucketName(uploadType);
    if (!bucket) {
      throw new BadRequestException("Invalid upload type");
    }

    const response = await this.s3Service.listObjectsV2({
      Bucket: bucket,
      Prefix: "",
    });

    const files = (response.Contents || [])
      .filter((item) => item.Key && !item.Key.endsWith("/"))
      .map((item) => {
        const key = item.Key;
        const fileName = key.split("/").pop() || "untitled";

        return {
          id: `file-${key}`,
          fileName,
          fileType: this.getFileType(fileName),
          cosKey: key,
          cosBucket: bucket,
          fileSize: item.Size,
          createdAt:
            item.LastModified?.toISOString() ?? new Date().toISOString(),
          path: "/" + key.split("/").slice(0, -1).join("/"),
        };
      });

    return files;
  }

  async moveFile(moveFileDto: MoveFileDto): Promise<any> {
    const { sourceKey, targetPath, bucket } = moveFileDto;

    if (!sourceKey || !bucket) {
      throw new BadRequestException("sourceKey and bucket are required");
    }

    const segments = sourceKey.split("/");
    const fileName = segments.at(-1);
    const newKey =
      targetPath === "/" ? fileName : `${targetPath.slice(1)}/${fileName}`;

    await this.s3Service.copyObject({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: newKey,
    });

    await this.s3Service.deleteObject({
      Bucket: bucket,
      Key: sourceKey,
    });

    return {
      success: true,
      message: "File moved successfully",
      newKey,
    };
  }

  async renameFile(renameFileDto: RenameFileDto): Promise<any> {
    const { sourceKey, newFileName, bucket } = renameFileDto;

    if (!sourceKey || !bucket) {
      throw new BadRequestException("sourceKey and bucket are required");
    }

    const pathParts = sourceKey.split("/");
    pathParts.pop();
    const prefix = pathParts.join("/");
    const newKey = prefix ? `${prefix}/${newFileName}` : newFileName;

    await this.s3Service.copyObject({
      Bucket: bucket,
      CopySource: `/${bucket}/${sourceKey}`,
      Key: newKey,
    });

    await this.s3Service.deleteObject({
      Bucket: bucket,
      Key: sourceKey,
    });

    return {
      success: true,
      message: "File renamed successfully",
      newKey,
    };
  }

  private getFileType(fileName: string): string {
    const MIME_TYPES: Record<string, string> = {
      tar: "application/x-tar",
      gz: "application/gzip",
      zip: "application/zip",
      "7z": "application/x-7z-compressed",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      svg: "image/svg+xml",
      webp: "image/webp",
      avif: "image/avif",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      mp4: "video/mp4",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      txt: "text/plain",
      md: "text/markdown",
      csv: "text/csv",
      html: "text/html",
      css: "text/css",
      js: "application/javascript",
      ts: "application/typescript",
      tsx: "application/typescript",
      sh: "application/x-sh",
      sql: "application/sql",
      json: "application/json",
      xml: "application/xml",
      yaml: "application/x-yaml",
      yml: "application/x-yaml",
      ipynb: "application/x-ipynb+json",
      wasm: "application/wasm",
    };

    const baseName = fileName.split(/[#?]/)[0].toLowerCase();
    const parts = baseName.split(".");
    if (parts.length < 2) return "application/octet-stream";

    for (let index = 2; index <= parts.length; index++) {
      const extension = parts.slice(-index).join(".");
      if (MIME_TYPES[extension]) return MIME_TYPES[extension];
    }

    const lastExtension = parts.pop();
    return MIME_TYPES[lastExtension] ?? "application/octet-stream";
  }
}
