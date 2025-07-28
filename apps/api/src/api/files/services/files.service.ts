import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CreateFolderDto } from "../dto/create-folder.dto";
import {
  FileMetadataDto,
  FileResponseDto,
  FolderListingDto,
} from "../dto/file-metadata.dto";
import { MoveFileDto } from "../dto/move-file.dto";
import { RenameFileDto } from "../dto/rename-file.dto";
import {
  UploadRequestDto,
  UploadResponseDto,
  UploadType,
} from "../dto/upload.dto";
import { S3Service } from "./s3.service";

@Injectable()
export class FilesService {
  constructor(private s3Service: S3Service) {}

  private getCurrentMonth(): string {
    const now = new Date();
    return now.toLocaleString("default", { month: "long" }).toLowerCase();
  }

  private generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async generateUploadUrl(
    uploadRequest: UploadRequestDto,
    userId: string,
  ): Promise<UploadResponseDto> {
    const { fileName, fileType, uploadType, context = {} } = uploadRequest;

    const bucket = this.s3Service.getBucketName(uploadType);
    if (!bucket) {
      throw new BadRequestException("Invalid upload type");
    }

    let prefix = "";
    const normalizedPath = context.path?.startsWith("/")
      ? context.path.slice(1)
      : (context.path ?? "");

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

        prefix = normalizedPath
          ? `${normalizedPath}/`
          : `${context.assignmentId}/${userId}/${context.questionId}/`;
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

    const presignedUrl = this.s3Service.getSignedUrl("putObject", {
      Bucket: bucket,
      Key: key,
      ContentType: fileType,
      Expires: 300,
    });

    return {
      presignedUrl,
      key,
      bucket,
      fileType,
      fileName,
      uploadType,
    };
  }

  generatePublicUrl(key: string): { presignedUrl: string } {
    const bucket = process.env.S3_PUBLIC_BUCKET;

    const presignedUrl = this.s3Service.getSignedUrl("getObject", {
      Bucket: bucket,
      Key: key,
      Expires: 3600,
    });

    return { presignedUrl };
  }

  async directUpload(
    file: Express.Multer.File,
    bucket: string,
    key: string,
  ): Promise<any> {
    try {
      await this.s3Service.headBucket({ Bucket: bucket });
    } catch {
      throw new NotFoundException(
        "Bucket does not exist or you do not have permission to access it",
      );
    }

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

    const presignedUrl = this.s3Service.getSignedUrl("getObject", {
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

    const lastExtension = parts.pop()!;
    return MIME_TYPES[lastExtension] ?? "application/octet-stream";
  }
}
