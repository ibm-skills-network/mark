import { Injectable, Logger } from "@nestjs/common";
import {
  GetObjectCommand,
  GetObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class FileService {
  private readonly s3Client: S3Client;
  private readonly logger = new Logger(FileService.name);

  constructor() {
    this.s3Client = new S3Client({
      endpoint: process.env.IBM_COS_ENDPOINT,
      credentials: {
        accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY || "",
      },
      forcePathStyle: true,
      region: process.env.IBM_COS_REGION || "us-east",
    });
  }

  private async getObjectBuffer(parameters: GetObjectCommandInput): Promise<{
    buffer: Buffer;
    contentType?: string;
  }> {
    const response = await this.s3Client.send(new GetObjectCommand(parameters));

    if (!response.Body) {
      throw new Error("No file content received from COS");
    }

    const body = response.Body;
    let buffer: Buffer;

    if (Buffer.isBuffer(body)) {
      buffer = body;
    } else if (body instanceof Uint8Array) {
      buffer = Buffer.from(body);
    } else {
      const chunks: Uint8Array[] = [];
      const stream = body as NodeJS.ReadableStream;

      buffer = await new Promise((resolve, reject) => {
        stream.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
    }

    return { buffer, contentType: response.ContentType };
  }

  /**
   * Retrieves file content from IBM Cloud Object Storage
   * @param key The file key in the bucket
   * @param bucket The bucket name
   * @returns The file content as a string
   */
  async getFileContent(key: string, bucket: string): Promise<string> {
    try {
      const parameters = {
        Bucket: bucket,
        Key: key,
      };

      this.logger.log(`Fetching file: ${key} from bucket: ${bucket}`);
      const { buffer, contentType } = await this.getObjectBuffer(parameters);
      const fileContent = buffer.toString("utf8");

      if (
        contentType &&
        !contentType.includes("text/") &&
        !contentType.includes("application/json")
      ) {
        this.logger.warn(
          `File ${key} is binary (${contentType}). Content might not be readable.`,
        );
      }

      return fileContent;
    } catch (error) {
      this.logger.error(`Failed to fetch file from COS: ${key}`, error);
      throw error;
    }
  }

  /**
   * Processes a file based on its type and returns content suitable for LLM analysis
   * @param key File key
   * @param bucket Bucket name
   * @param filename Original filename
   * @returns Processed content suitable for LLM analysis
   */
  async getProcessedFileContent(
    key: string,
    bucket: string,
    filename: string,
  ): Promise<string> {
    try {
      const fileExtension = filename.split(".").pop()?.toLowerCase();

      const textExtensions = [
        "txt",
        "md",
        "json",
        "csv",
        "html",
        "xml",
        "js",
        "ts",
        "py",
        "java",
        "c",
        "cpp",
      ];
      if (textExtensions.includes(fileExtension)) {
        return await this.getFileContent(key, bucket);
      }

      if (fileExtension === "pdf") {
        try {
          const content = await this.getFileContent(key, bucket);
          return content;
        } catch {
          return "[PDF content extraction not available]";
        }
      }

      const imageExtensions = ["jpg", "jpeg", "png", "gif", "bmp"];
      if (imageExtensions.includes(fileExtension)) {
        return `[Image file: ${filename}]`;
      }

      const content = await this.getFileContent(key, bucket);

      const MAX_CONTENT_SIZE = 100 * 1024;
      if (content.length > MAX_CONTENT_SIZE) {
        return (
          content.slice(0, Math.max(0, MAX_CONTENT_SIZE)) +
          `\n\n[Content truncated - original file size exceeds limits for direct processing]`
        );
      }

      return content;
    } catch (error) {
      this.logger.error(`Error processing file ${filename} (${key})`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return `[Error processing file: ${errorMessage}]`;
    }
  }

  /**
   * Generates a pre-signed URL for accessing a file
   * @param key The file key in the bucket
   * @param bucket The bucket name
   * @returns A pre-signed URL with temporary access to the file
   */
  async getFileUrl(key: string, bucket: string): Promise<string> {
    return getS3SignedUrl(
      this.s3Client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn: 3600 },
    );
  }

  /**
   * Generates a pre-signed URL for accessing a file with extended access time for LLM processing
   * @param key The file key in the bucket
   * @param bucket The bucket name
   * @returns A pre-signed URL with temporary access to the file
   */
  async getFileAccessUrl(key: string, bucket: string): Promise<string> {
    return getS3SignedUrl(
      this.s3Client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn: 24 * 60 * 60 },
    );
  }
}
