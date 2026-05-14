/* eslint-disable */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiOperation, ApiQuery, ApiResponse } from "@nestjs/swagger";
import { memoryStorage } from "multer";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Logger } from "winston";
import { CreateFolderDto } from "./dto/create-folder.dto";
import { MoveFileDto } from "./dto/move-file.dto";
import { RenameFileDto } from "./dto/rename-file.dto";
import {
  AbortMultipartUploadRequestDto,
  CompleteMultipartUploadRequestDto,
  DirectUploadDto,
  UploadContextDto,
  UploadRequestDto,
  UploadType,
} from "./dto/upload.dto";
import { AuthGuard } from "./guards/auth.guard";
import { FilesService } from "./services/files.service";
import { S3Service } from "./services/s3.service";
import { sanitizeForLog } from "../../logger/sanitize";

export interface FileAccessDto {
  filename: string;
  size: number;
  contentType: string;
  lastModified: Date;
  isImage: boolean;
  isPdf: boolean;
  isText: boolean;
  viewUrl: string;
  downloadUrl: string;
  textContentUrl?: string;
}

export interface FileContentDto {
  content: string;
  filename: string;
  size: number;
}

@Controller({
  path: "files",
  version: "1",
})
export class FilesController {
  private readonly logger: Logger;

  constructor(
    private readonly filesService: FilesService,
    private readonly s3Service: S3Service,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: FilesController.name });
  }

  @Get("public-url")
  async getPublicUrl(@Query("key") key: string) {
    if (!key) {
      throw new BadRequestException("Missing required parameter: key");
    }
    return this.filesService.generatePublicUrl(key);
  }

  @Get("_budget")
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary:
      "Admin-only snapshot of file-processing budget. pod.* is per-replica, cluster.* aggregates FileUpload rows in PENDING status.",
  })
  @ApiResponse({
    status: 200,
    description: "Budget snapshot",
    schema: {
      type: "object",
      properties: {
        pod: {
          type: "object",
          properties: {
            budget: { type: "number", description: "Total budget in bytes" },
            inflight: {
              type: "number",
              description: "Bytes currently held by active claims on this pod",
            },
            waiters: {
              type: "number",
              description: "Requests queued waiting for budget",
            },
            claims: {
              type: "number",
              description: "Number of active upload IDs on this pod",
            },
          },
        },
        cluster: {
          type: "object",
          properties: {
            pendingUploads: {
              type: "number",
              description: "FileUpload rows still in PENDING status",
            },
            pendingBytes: {
              type: "number",
              description: "Sum of sizeBytes for PENDING rows across all pods",
            },
          },
        },
      },
    },
  })
  async getBudgetStatus(@Req() request: UserSessionRequest) {
    if (request.userSession.role !== UserRole.ADMIN) {
      throw new ForbiddenException();
    }
    const podStatus = this.filesService.getProcessingBudgetStatus();
    const claims = this.filesService.getBudgetClaimsSnapshot();
    const cluster = await this.filesService.getPendingUploadAggregate();
    return {
      pod: {
        budget: podStatus.budget,
        inflight: podStatus.inflight,
        waiters: podStatus.waiters,
        claims: claims.count,
      },
      cluster: {
        pendingUploads: cluster.count,
        pendingBytes: cluster.totalBytes,
      },
    };
  }

  @Post("upload")
  @UseGuards(AuthGuard)
  async generateUploadUrl(
    @Body() uploadRequest: UploadRequestDto,
    @Req() request: UserSessionRequest,
  ) {
    return this.filesService.generateUploadUrl(
      uploadRequest,
      request.userSession.userId,
      request.userSession.role,
    );
  }

  @Post("upload/initiate")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Initiate multipart upload and return part URLs" })
  async initiateMultipartUpload(
    @Body() uploadRequest: UploadRequestDto,
    @Req() request: UserSessionRequest,
  ) {
    return this.filesService.initiateMultipartUpload(
      uploadRequest,
      request.userSession.userId,
      request.userSession.role,
    );
  }

  @Post("upload/complete")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Complete multipart upload using uploaded parts" })
  async completeMultipartUpload(
    @Body() body: CompleteMultipartUploadRequestDto,
    @Req() request: UserSessionRequest,
  ) {
    return this.filesService.completeMultipartUpload(
      body,
      request.userSession.userId,
    );
  }

  @Post("upload/abort")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Abort an in-progress multipart upload" })
  async abortMultipartUpload(
    @Body() body: AbortMultipartUploadRequestDto,
    @Req() request: UserSessionRequest,
  ): Promise<void> {
    return this.filesService.abortMultipartUpload(
      body,
      request.userSession.userId,
    );
  }

  @Post("direct-upload")
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: {
        fileSize: 100 * 1024 * 1024,
      },
    }),
  )
  @ApiOperation({
    summary: "Direct upload file through backend (bypasses CORS)",
  })
  async directUpload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: DirectUploadDto,
    @Req() request: UserSessionRequest,
  ) {
    if (!file) {
      throw new BadRequestException("No file provided");
    }

    let context: UploadContextDto = {};
    if (body.context) {
      try {
        context = JSON.parse(body.context);
      } catch (error) {
        this.logger.error("[DIRECT UPLOAD] Failed to parse context", {
          context_raw: sanitizeForLog(body.context),
          error: sanitizeForLog(
            error instanceof Error ? error.message : String(error),
          ),
        });
        throw new BadRequestException("Invalid context JSON");
      }
    }

    const userId = request.userSession.userId;

    const { bucket, key } = this.filesService.resolveUploadTarget(
      {
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        uploadType: body.uploadType,
        context,
      },
      userId,
      request.userSession.role,
    );

    const result = await this.filesService.directUpload(file, bucket, key);

    return {
      success: true,
      key,
      bucket,
      fileType: file.mimetype,
      fileName: file.originalname,
      uploadType: body.uploadType,
      size: file.size,
      etag: result.etag,
    };
  }

  @Get("access")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Get direct file access URLs using presigned URLs" })
  @ApiQuery({ name: "key", required: true, description: "File key in storage" })
  @ApiQuery({
    name: "bucket",
    required: true,
    description: "Storage bucket name",
  })
  @ApiQuery({
    name: "expiration",
    required: false,
    description: "URL expiration in seconds (default: 3600)",
  })
  @ApiResponse({
    type: Object,
    description: "File access information with direct URLs",
  })
  async getFileAccess(
    @Query("key") key: string,
    @Query("bucket") bucket: string,
    @Query("expiration") expiration = "3600",
    @Req() request?: UserSessionRequest,
  ): Promise<FileAccessDto> {
    try {
      this.assertAccessAllowed(key, bucket, request?.userSession);

      const expirationSeconds = Number.parseInt(expiration, 10);

      const metadata = await this.s3Service.headObject({
        Bucket: bucket,
        Key: key,
      });

      const filename = key.split("/").pop() || key;
      const contentType = this.getContentType(filename);
      const isImage = this.isImageFile(filename);
      const isPdf = this.isPdfFile(filename);
      const isText = this.isTextFile(filename);

      const viewUrl = await this.s3Service.getSignedUrl("getObject", {
        Bucket: bucket,
        Key: key,
        Expires: expirationSeconds,
        ResponseContentDisposition: `inline; filename="${filename}"`,
        ResponseContentType: contentType,
      });

      const downloadUrl = await this.s3Service.getSignedUrl("getObject", {
        Bucket: bucket,
        Key: key,
        Expires: expirationSeconds,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
        ResponseContentType: contentType,
      });

      let textContentUrl: string | undefined;
      if (isText) {
        textContentUrl = `/api/v1/files/content?key=${encodeURIComponent(
          key,
        )}&bucket=${encodeURIComponent(bucket)}`;
      }

      return {
        filename,
        size: metadata.ContentLength || 0,
        contentType,
        lastModified: metadata.LastModified || new Date(),
        isImage,
        isPdf,
        isText,
        viewUrl,
        downloadUrl,
        textContentUrl,
      };
    } catch (error) {
      this.logger.error("[FILES] File access error", {
        key: sanitizeForLog(key),
        bucket: sanitizeForLog(bucket),
        error: sanitizeForLog(
          error instanceof Error ? error.message : String(error),
        ),
        stack: sanitizeForLog(error instanceof Error ? error.stack : undefined),
      });
      throw new NotFoundException();
    }
  }

  /**
   * Authorize a file access request:
   * - require an authenticated user session
   * - require the bucket to match one of the configured upload buckets
   * - require the key to be owned by the caller (path segment match) or the
   *   caller to be an admin
   * Logs and throws a generic 4xx for the controller to translate into 404.
   */
  private assertAccessAllowed(
    key: string,
    bucket: string,
    userSession: UserSession | undefined,
  ): void {
    if (!key || !bucket) {
      throw new BadRequestException();
    }
    if (!userSession?.userId) {
      throw new ForbiddenException();
    }
    if (!this.s3Service.isConfiguredUploadBucket(bucket)) {
      throw new ForbiddenException();
    }
    if (userSession.role === UserRole.ADMIN) {
      return;
    }
    const segments = key.split("/").filter(Boolean);
    if (!segments.includes(userSession.userId)) {
      throw new ForbiddenException();
    }
  }

  /**
   * Get file content as text (for text files only) - direct from S3
   */
  @Get("content")
  @ApiOperation({ summary: "Get file content as text" })
  @ApiQuery({ name: "key", required: true, description: "File key in storage" })
  @ApiQuery({
    name: "bucket",
    required: true,
    description: "Storage bucket name",
  })
  @ApiQuery({
    name: "encoding",
    required: false,
    description: "Text encoding (default: utf8)",
  })
  @ApiResponse({ type: Object, description: "File content as text" })
  async getFileContent(
    @Query("key") key: string,
    @Query("bucket") bucket: string,
    @Query("encoding") encoding = "utf8",
    @Req() request?: UserSessionRequest,
  ): Promise<FileContentDto> {
    try {
      this.assertAccessAllowed(key, bucket, request?.userSession);

      const filename = key.split("/").pop() || key;

      if (!this.isTextFile(filename)) {
        throw new HttpException(
          "Only text files are supported for content retrieval",
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.s3Service.getObject({
        Bucket: bucket,
        Key: key,
      });

      if (!result.Body) {
        throw new HttpException("File not found", HttpStatus.NOT_FOUND);
      }

      let content: string;

      if (Buffer.isBuffer(result.Body)) {
        content = result.Body.toString(encoding as BufferEncoding);
      } else if (result.Body instanceof Uint8Array) {
        content = Buffer.from(result.Body).toString(encoding as BufferEncoding);
      } else {
        const chunks: Buffer[] = [];
        const stream = result.Body as NodeJS.ReadableStream;

        const buffer = await new Promise<Buffer>((resolve, reject) => {
          stream.on("data", (chunk: any) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          stream.on("end", () => resolve(Buffer.concat(chunks)));
          stream.on("error", reject);
        });
        content = buffer.toString(encoding as BufferEncoding);
      }

      if (this.containsBinaryData(content)) {
        throw new HttpException(
          "File contains binary data",
          HttpStatus.BAD_REQUEST,
        );
      }

      return {
        content,
        filename,
        size: Buffer.byteLength(content, encoding as BufferEncoding),
      };
    } catch (error) {
      this.logger.error(`[FILES] Content error for ${sanitizeForLog(key)}`, {
        key: sanitizeForLog(key),
        error: sanitizeForLog(
          error instanceof Error ? error.message : String(error),
        ),
        stack: sanitizeForLog(error instanceof Error ? error.stack : undefined),
      });
      throw new NotFoundException();
    }
  }

  private getContentType(filename: string): string {
    const extension = filename.split(".").pop()?.toLowerCase() || "";

    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      svg: "image/svg+xml",
      bmp: "image/bmp",
      webp: "image/webp",
      avif: "image/avif",
      ico: "image/x-icon",
      tiff: "image/tiff",
      tif: "image/tiff",

      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",

      txt: "text/plain; charset=utf-8",
      md: "text/markdown; charset=utf-8",
      json: "application/json; charset=utf-8",
      xml: "application/xml; charset=utf-8",
      html: "text/html; charset=utf-8",
      css: "text/css; charset=utf-8",
      js: "application/javascript; charset=utf-8",
      ts: "application/typescript; charset=utf-8",
      tsx: "application/typescript; charset=utf-8",
      jsx: "application/javascript; charset=utf-8",
      py: "text/x-python; charset=utf-8",
      java: "text/x-java-source; charset=utf-8",
      cpp: "text/x-c++src; charset=utf-8",
      c: "text/x-csrc; charset=utf-8",
      cs: "text/x-csharp; charset=utf-8",
      php: "text/x-php; charset=utf-8",
      rb: "text/x-ruby; charset=utf-8",
      go: "text/x-go; charset=utf-8",
      rs: "text/x-rust; charset=utf-8",
      swift: "text/x-swift; charset=utf-8",
      kt: "text/x-kotlin; charset=utf-8",
      scala: "text/x-scala; charset=utf-8",
      sql: "application/sql; charset=utf-8",
      sh: "application/x-sh; charset=utf-8",
      yaml: "application/x-yaml; charset=utf-8",
      yml: "application/x-yaml; charset=utf-8",
      csv: "text/csv; charset=utf-8",
      ipynb: "application/x-ipynb+json; charset=utf-8",
      log: "text/plain; charset=utf-8",

      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      aac: "audio/aac",
      m4a: "audio/m4a",
      flac: "audio/flac",
      mp4: "video/mp4",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      webm: "video/webm",

      zip: "application/zip",
      rar: "application/x-rar-compressed",
      "7z": "application/x-7z-compressed",
      tar: "application/x-tar",
      gz: "application/gzip",
    };

    return mimeTypes[extension] || "application/octet-stream";
  }

  private isImageFile(filename: string): boolean {
    const imageExtensions = [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "svg",
      "bmp",
      "webp",
      "avif",
      "ico",
      "tiff",
      "tif",
    ];
    const extension = filename.split(".").pop()?.toLowerCase() || "";
    return imageExtensions.includes(extension);
  }

  private isPdfFile(filename: string): boolean {
    return filename.split(".").pop()?.toLowerCase() === "pdf";
  }

  private isTextFile(filename: string): boolean {
    const textExtensions = [
      "txt",
      "md",
      "json",
      "xml",
      "html",
      "css",
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "java",
      "cpp",
      "c",
      "cs",
      "php",
      "rb",
      "go",
      "rs",
      "swift",
      "kt",
      "scala",
      "sql",
      "sh",
      "yaml",
      "yml",
      "csv",
      "ipynb",
      "log",
    ];
    const extension = filename.split(".").pop()?.toLowerCase() || "";
    return textExtensions.includes(extension);
  }

  private containsBinaryData(content: string): boolean {
    for (let index = 0; index < Math.min(content.length, 1024); index++) {
      const code = content.codePointAt(index);
      if (
        code === 0 ||
        (code < 32 && code !== 9 && code !== 10 && code !== 13)
      ) {
        return true;
      }
    }
    return false;
  }

  @Post("folder")
  @UseGuards(AuthGuard)
  async createFolder(@Body() createFolderDto: CreateFolderDto) {
    return this.filesService.createFolder(createFolderDto);
  }

  @Get("download")
  @UseGuards(AuthGuard)
  async getFileDownload(
    @Query("fileId") fileId: string,
    @Query("uploadType") uploadType: string,
  ) {
    if (!fileId || !uploadType) {
      throw new BadRequestException(
        "Missing required parameters: fileId and uploadType are required",
      );
    }
    return this.filesService.getFileAccess(uploadType, fileId);
  }

  @Get("empty-folders")
  @UseGuards(AuthGuard)
  async listEmptyFolders(
    @Query("uploadType") uploadType: string,
    @Query("groupId") groupId?: string,
  ) {
    if (!uploadType) {
      throw new BadRequestException("Missing required parameter: uploadType");
    }
    return this.filesService.listEmptyFolders(uploadType, groupId);
  }

  @Get()
  @UseGuards(AuthGuard)
  async listFiles(@Query("uploadType") uploadType: string) {
    if (!uploadType) {
      throw new BadRequestException("Missing required parameter: uploadType");
    }
    return this.filesService.listFiles(uploadType);
  }

  @Delete(":fileId")
  @UseGuards(AuthGuard)
  async deleteFile(
    @Param("fileId") fileId: string,
    @Query("uploadType") uploadType: string,
    @Query("key") key?: string,
  ) {
    if (!uploadType) {
      throw new BadRequestException("Missing required parameter: uploadType");
    }
    if (!fileId && !key) {
      throw new BadRequestException(
        "Missing required parameter: fileId or key",
      );
    }

    if (key) {
      return this.filesService.deleteFile(uploadType, key);
    }

    throw new BadRequestException(
      "In development mode, direct key deletion is required",
    );
  }

  @Delete("folder")
  @UseGuards(AuthGuard)
  async deleteFolder(
    @Query("folderPath") folderPath: string,
    @Query("uploadType") uploadType: string,
  ) {
    if (!uploadType) {
      throw new BadRequestException("Missing required parameter: uploadType");
    }
    if (!folderPath) {
      throw new BadRequestException("Missing required parameter: folderPath");
    }
    return this.filesService.deleteFolder(uploadType, folderPath);
  }

  @Put("move")
  @UseGuards(AuthGuard)
  async moveFile(@Body() moveFileDto: MoveFileDto) {
    return this.filesService.moveFile(moveFileDto);
  }

  @Put("rename")
  @UseGuards(AuthGuard)
  async renameFile(@Body() renameFileDto: RenameFileDto) {
    return this.filesService.renameFile(renameFileDto);
  }

  @Get("bucket-info")
  @ApiOperation({
    summary: "Get bucket information including region and environment",
  })
  @ApiQuery({
    name: "bucket",
    required: true,
    description: "Bucket name to get information for",
  })
  async getBucketInfo(@Query("bucket") bucket: string) {
    if (!bucket) {
      throw new BadRequestException("Bucket parameter is required");
    }

    return this.filesService.getBucketInfo(bucket);
  }

  @Get("bucket-for-environment")
  @ApiOperation({
    summary: "Get appropriate bucket name for upload type and environment",
  })
  @ApiQuery({
    name: "uploadType",
    required: true,
    description: "Upload type (author, learner, debug)",
  })
  @ApiQuery({
    name: "isProduction",
    required: false,
    description: "Whether to use production bucket (default: false)",
  })
  async getBucketForEnvironment(
    @Query("uploadType") uploadType: string,
    @Query("isProduction") isProduction = "false",
  ) {
    if (!uploadType) {
      throw new BadRequestException("uploadType parameter is required");
    }

    const isProductionBool = isProduction.toLowerCase() === "true";
    const bucket = this.filesService.getBucketForEnvironment(
      uploadType as UploadType,
      isProductionBool,
    );

    return {
      bucket,
      uploadType,
      isProduction: isProductionBool,
      ...this.filesService.getBucketInfo(bucket),
    };
  }
}
