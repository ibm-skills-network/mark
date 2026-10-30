import type { ObjectCannedACL } from "@aws-sdk/client-s3";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  UserRole,
  UserSession,
} from "src/auth/interfaces/user.session.interface";
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
import { fileExtension, learnerUploadExtensions } from "./learner-upload-types";
import { sanitizeUploadFileName, sanitizeUploadPath } from "./path-sanitizer";
import { S3Service } from "./s3.service";
import {
  authorUploadKeyPrefix,
  generateStorageKeyId,
  isWellFormedStorageKey,
} from "./storage-key";

type ManagementSession = Pick<UserSession, "role" | "userId">;

/** Where an author or admin file-management call may read and write. */
export interface FileManagementScope {
  bucket: string;
  /** Every key touched must start with this; "" for admins. */
  prefix: string;
}

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
    const { fileType, fileSize, uploadType } = uploadRequest;
    const fileName = sanitizeUploadFileName(uploadRequest.fileName);

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

    let prefix = "";
    const normalizedPath = sanitizeUploadPath(context.path);

    switch (uploadType) {
      case UploadType.AUTHOR: {
        const ownPrefix = authorUploadKeyPrefix(userId);
        prefix = normalizedPath ? `${normalizedPath}/` : ownPrefix;
        // A chosen folder must still be the author's own, as for move,
        // rename and listing; admins may write anywhere in the bucket.
        if (
          role !== UserRole.ADMIN &&
          (!userId ||
            !prefix.startsWith(ownPrefix) ||
            !isWellFormedStorageKey(prefix.slice(0, -1)))
        ) {
          this.logger.warn("upload_rejected: author path outside own prefix", {
            denial_reason: "author_path_out_of_scope",
            user_id: userId,
            role,
          });
          throw new ForbiddenException();
        }
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

    const uniqueId = generateStorageKeyId();
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

  /**
   * A learner upload is written under the assignment named in its context,
   * so that assignment must be the one the session was launched into.
   * Admins are exempt. Throws 403.
   */
  assertUploadContextMatchesSession(
    uploadRequest: Pick<UploadRequestDto, "uploadType" | "context">,
    session: Pick<UserSession, "assignmentId" | "role" | "userId">,
  ): void {
    if (
      session.role === UserRole.ADMIN ||
      (uploadRequest.uploadType !== UploadType.LEARNER &&
        uploadRequest.uploadType !== UploadType.LEARNER_PROD)
    ) {
      return;
    }
    const contextAssignmentId: unknown = isPlainObject(uploadRequest.context)
      ? uploadRequest.context.assignmentId
      : undefined;
    if (
      typeof session.assignmentId !== "number" ||
      contextAssignmentId !== session.assignmentId
    ) {
      this.logger.warn("upload_rejected: context assignment not in session", {
        denial_reason: "context_assignment_mismatch",
        user_id: session.userId,
        assignment_id: session.assignmentId,
        upload_type: uploadRequest.uploadType,
      });
      throw new ForbiddenException();
    }
  }

  /**
   * Who may delete which stored object. A learner may delete only their own
   * answer uploads for the session's assignment; an author only their own
   * author files (under `authors/<userId>/`); an admin anything. Keys with
   * `.`/`..`/empty segments, backslashes or control characters never pass. Anything else is a bare 404 so the response never says whether
   * the object exists.
   */
  assertDeleteAllowed(
    uploadType: string,
    key: string,
    session: Pick<UserSession, "assignmentId" | "role" | "userId">,
  ): void {
    if (session.role === UserRole.ADMIN) {
      return;
    }
    let allowed = false;
    if (session.userId && typeof key === "string" && key.length > 0) {
      if (session.role === UserRole.LEARNER) {
        const isLearnerType =
          uploadType === UploadType.LEARNER ||
          uploadType === UploadType.LEARNER_PROD;
        allowed =
          isLearnerType &&
          typeof session.assignmentId === "number" &&
          key.startsWith(`${session.assignmentId}/${session.userId}/`);
      } else if (session.role === UserRole.AUTHOR) {
        allowed =
          uploadType === UploadType.AUTHOR &&
          key.startsWith(authorUploadKeyPrefix(session.userId));
      }
      allowed = allowed && isWellFormedStorageKey(key);
    }
    if (!allowed) {
      this.logger.warn("delete_rejected: key not owned by caller", {
        denial_reason: "delete_not_owned",
        user_id: session.userId,
        assignment_id: session.assignmentId,
        role: session.role,
        upload_type: uploadType,
      });
      throw new NotFoundException();
    }
  }

  /**
   * Bucket and key prefix for an author or admin file-management call. The
   * bucket always comes from `uploadType`, never from the request body. An
   * author may manage only author files under their own `authors/<userId>/`
   * prefix; an admin any configured bucket. Anyone else gets a bare 403.
   */
  resolveManagementScope(
    uploadType: unknown,
    session: ManagementSession,
  ): FileManagementScope {
    if (typeof uploadType !== "string" || uploadType.length === 0) {
      throw new BadRequestException("Invalid upload type");
    }
    if (session.role === UserRole.ADMIN) {
      return { bucket: this.s3Service.getBucketName(uploadType), prefix: "" };
    }
    if (
      session.role !== UserRole.AUTHOR ||
      !session.userId ||
      uploadType !== UploadType.AUTHOR
    ) {
      this.logger.warn("file_management_rejected: role or upload type", {
        denial_reason: "management_not_allowed",
        user_id: session.userId,
        role: session.role,
        upload_type: uploadType,
      });
      throw new ForbiddenException();
    }
    return {
      bucket: this.s3Service.getBucketName(UploadType.AUTHOR),
      prefix: authorUploadKeyPrefix(session.userId),
    };
  }

  /**
   * 403 unless `key` is well formed and strictly inside the scope's prefix.
   * The response never says which check failed.
   */
  private assertKeyInScope(
    key: unknown,
    scope: FileManagementScope,
    session: ManagementSession,
    operation: string,
  ): asserts key is string {
    const inScope =
      isWellFormedStorageKey(key) &&
      key.startsWith(scope.prefix) &&
      key.length > scope.prefix.length;
    if (!inScope) {
      this.logger.warn("file_management_rejected: key outside caller scope", {
        denial_reason: "key_out_of_scope",
        operation,
        user_id: session.userId,
        role: session.role,
      });
      throw new ForbiddenException();
    }
  }

  /** A body-supplied bucket, when sent at all, must be the derived one. */
  private assertBodyBucketMatches(
    bodyBucket: unknown,
    scope: FileManagementScope,
    session: ManagementSession,
    operation: string,
  ): void {
    if (bodyBucket === undefined || bodyBucket === scope.bucket) {
      return;
    }
    this.logger.warn("file_management_rejected: bucket mismatch", {
      denial_reason: "bucket_mismatch",
      operation,
      user_id: session.userId,
      role: session.role,
    });
    throw new ForbiddenException();
  }

  /** "/" or "/a/b" to the key form "" or "a/b"; anything else is a 400. */
  private folderPathToKey(path: unknown): string {
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new BadRequestException("Path must start with /");
    }
    return path === "/" ? "" : path.slice(1);
  }

  /** A single file or folder name: one well-formed key segment. */
  private assertSingleSegmentName(name: unknown): asserts name is string {
    if (!isWellFormedStorageKey(name) || name.includes("/")) {
      throw new BadRequestException("Invalid name");
    }
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
  /**
   * A learner's file must belong to a question in the assignment it names and
   * be a type that question accepts. The browser's picker filters the same
   * types, but nothing stops a client posting here directly, and a wrong file
   * only surfaces later as an attempt that can't be graded. Authors are not
   * checked: previews upload against questions that may not be saved yet.
   */
  async assertLearnerFileFitsQuestion(
    uploadRequest: UploadRequestDto,
    userId: string,
    role: UserRole,
  ): Promise<void> {
    const { uploadType, fileName, context } = uploadRequest;
    if (
      role !== UserRole.LEARNER ||
      (uploadType !== UploadType.LEARNER &&
        uploadType !== UploadType.LEARNER_PROD)
    ) {
      return;
    }
    const assignmentId: unknown = context?.assignmentId;
    const questionId: unknown = context?.questionId;
    // resolveUploadTarget rejects these first; checked again so this method
    // never trusts its caller's order.
    if (typeof assignmentId !== "number" || typeof questionId !== "number") {
      throw new BadRequestException("Invalid upload context");
    }

    const question =
      (await this.prisma.question.findFirst({
        where: { id: questionId, assignmentId, isDeleted: false },
        select: { type: true, responseType: true },
      })) ??
      // A republish soft-deletes the old question rows, but an attempt opened
      // before it still serves the pinned version's questions. Accept those
      // for the learner's own open attempt so the attempt stays completable.
      (await this.prisma.questionVersion.findFirst({
        where: {
          questionId,
          assignmentVersion: {
            assignmentId,
            assignmentAttempts: { some: { userId, submitted: false } },
          },
        },
        select: { type: true, responseType: true },
      }));
    if (!question) {
      this.logger.warn("upload_rejected: question not in assignment", {
        denial_reason: "question_not_in_assignment",
        user_id: userId,
        assignment_id: assignmentId,
        question_id: questionId,
      });
      throw new BadRequestException("Invalid upload context");
    }

    const allowed = learnerUploadExtensions(
      question.type,
      question.responseType,
    );
    const extension = fileExtension(fileName);
    if (allowed && !allowed.includes(extension)) {
      this.logger.warn("upload_rejected: file type not accepted by question", {
        denial_reason: "file_type_not_accepted",
        user_id: userId,
        assignment_id: assignmentId,
        question_id: questionId,
        response_type: question.responseType ?? question.type,
        extension,
      });
      throw new BadRequestException(
        `This question doesn't accept ${extension || "that"} files. Allowed types: ${allowed.join(", ")}.`,
      );
    }
  }

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
    await this.assertLearnerFileFitsQuestion(uploadRequest, userId, role);
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
    await this.assertLearnerFileFitsQuestion(uploadRequest, userId, role);
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
   *
   * `options.contentType` overrides the client-claimed `file.mimetype`, and
   * `options.acl` sets a canned ACL on the object; both default to the
   * private, as-uploaded behaviour.
   */
  async directUpload(
    file: Express.Multer.File,
    bucket: string,
    key: string,
    options: { acl?: ObjectCannedACL; contentType?: string } = {},
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
        ContentType: options.contentType ?? file.mimetype,
        ...(options.acl ? { ACL: options.acl } : {}),
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

  async createFolder(
    createFolderDto: CreateFolderDto,
    session: ManagementSession,
  ): Promise<any> {
    const { name, path, uploadType } = createFolderDto;
    const scope = this.resolveManagementScope(uploadType, session);
    this.assertSingleSegmentName(name);
    const parentKey = this.folderPathToKey(path);
    const folderPath = parentKey ? `${parentKey}/${name}` : name;
    this.assertKeyInScope(folderPath, scope, session, "create_folder");
    const folderKey = `${folderPath}/`;

    await this.s3Service.putObject({
      Bucket: scope.bucket,
      Key: folderKey,
      Body: "",
    });
    this.logger.log("folder_created", {
      user_id: session.userId,
      role: session.role,
      upload_type: uploadType,
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

  async deleteFolder(
    uploadType: string,
    folderPath: string,
    session: ManagementSession,
  ): Promise<any> {
    if (folderPath === "/") {
      throw new BadRequestException("Cannot delete the root folder");
    }

    const scope = this.resolveManagementScope(uploadType, session);
    const folderKey = this.folderPathToKey(folderPath);
    this.assertKeyInScope(folderKey, scope, session, "delete_folder");
    const bucket = scope.bucket;
    const folderPrefix = `${folderKey}/`;

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
    session: ManagementSession,
    groupId?: string,
  ): Promise<string[]> {
    const scope = this.resolveManagementScope(uploadType, session);
    const bucket = scope.bucket;

    // Authors list only their own prefix; the group filter is admin-only.
    const prefix =
      scope.prefix ||
      (groupId && uploadType === UploadType.AUTHOR ? `group-${groupId}/` : "");

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

  async listFiles(
    uploadType: string,
    session: ManagementSession,
  ): Promise<FileResponseDto[]> {
    const scope = this.resolveManagementScope(uploadType, session);
    const bucket = scope.bucket;

    const response = await this.s3Service.listObjectsV2({
      Bucket: bucket,
      Prefix: scope.prefix,
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

  async moveFile(
    moveFileDto: MoveFileDto,
    session: ManagementSession,
  ): Promise<any> {
    const { sourceKey, targetPath, uploadType } = moveFileDto;

    if (!sourceKey) {
      throw new BadRequestException("sourceKey is required");
    }

    const scope = this.resolveManagementScope(uploadType, session);
    this.assertBodyBucketMatches(moveFileDto.bucket, scope, session, "move");
    this.assertKeyInScope(sourceKey, scope, session, "move");
    const bucket = scope.bucket;

    const fileName = sourceKey.split("/").at(-1);
    const targetFolderKey = this.folderPathToKey(targetPath);
    const newKey = targetFolderKey
      ? `${targetFolderKey}/${fileName}`
      : fileName;
    this.assertKeyInScope(newKey, scope, session, "move");

    await this.s3Service.copyObject({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: newKey,
    });

    await this.s3Service.deleteObject({
      Bucket: bucket,
      Key: sourceKey,
    });

    this.logger.log("file_moved", {
      user_id: session.userId,
      role: session.role,
      upload_type: uploadType,
    });

    return {
      success: true,
      message: "File moved successfully",
      newKey,
    };
  }

  async renameFile(
    renameFileDto: RenameFileDto,
    session: ManagementSession,
  ): Promise<any> {
    const { sourceKey, newFileName, uploadType } = renameFileDto;

    if (!sourceKey) {
      throw new BadRequestException("sourceKey is required");
    }

    const scope = this.resolveManagementScope(uploadType, session);
    this.assertBodyBucketMatches(
      renameFileDto.bucket,
      scope,
      session,
      "rename",
    );
    this.assertKeyInScope(sourceKey, scope, session, "rename");
    this.assertSingleSegmentName(newFileName);
    const bucket = scope.bucket;

    const pathParts = sourceKey.split("/");
    pathParts.pop();
    const prefix = pathParts.join("/");
    const newKey = prefix ? `${prefix}/${newFileName}` : newFileName;
    this.assertKeyInScope(newKey, scope, session, "rename");

    await this.s3Service.copyObject({
      Bucket: bucket,
      CopySource: `/${bucket}/${sourceKey}`,
      Key: newKey,
    });

    await this.s3Service.deleteObject({
      Bucket: bucket,
      Key: sourceKey,
    });

    this.logger.log("file_renamed", {
      user_id: session.userId,
      role: session.role,
      upload_type: uploadType,
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
