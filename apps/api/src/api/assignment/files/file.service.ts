// file.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { S3 } from "aws-sdk";

@Injectable()
export class FileService {
  private readonly s3Client: S3;
  private readonly logger = new Logger(FileService.name);

  constructor() {
    this.s3Client = new S3({
      endpoint: process.env.IBM_COS_ENDPOINT,
      credentials: {
        accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY || "",
      },
      s3ForcePathStyle: true,
      signatureVersion: "v4",
      region: process.env.IBM_COS_REGION || "us-east",
    });
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
      const response = await this.s3Client.getObject(parameters).promise();

      // Convert Buffer to string
      const contentType = response.ContentType;
      const fileContent = response.Body.toString("utf8");

      // For binary files we might want to handle differently
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

      // For text files, get direct content
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

      // For PDFs, we might need specialized processing using a PDF parser library
      if (fileExtension === "pdf") {
        // This is a simplified approach - in production you'd use a PDF parser
        try {
          const content = await this.getFileContent(key, bucket);
          return content;
        } catch {
          return "[PDF content extraction not available]";
        }
      }

      // For images, we might want to skip content extraction entirely
      const imageExtensions = ["jpg", "jpeg", "png", "gif", "bmp"];
      if (imageExtensions.includes(fileExtension)) {
        return `[Image file: ${filename}]`;
      }

      // For other files, get a truncated version to avoid processing very large files
      const content = await this.getFileContent(key, bucket);

      // Truncate content if it's too large (e.g., over 100KB)
      const MAX_CONTENT_SIZE = 100 * 1024; // 100KB
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
  getFileUrl(key: string, bucket: string): string {
    return this.s3Client.getSignedUrl("getObject", {
      Bucket: bucket,
      Key: key,
      Expires: 3600, // URL is valid for 1 hour
    });
  }

  /**
   * Generates a pre-signed URL for accessing a file with extended access time for LLM processing
   * @param key The file key in the bucket
   * @param bucket The bucket name
   * @returns A pre-signed URL with temporary access to the file
   */
  getFileAccessUrl(key: string, bucket: string): string {
    // For LLM processing, we want to give a longer window of access
    return this.s3Client.getSignedUrl("getObject", {
      Bucket: bucket,
      Key: key,
      Expires: 24 * 60 * 60, // URL is valid for 24 hours to ensure LLM has time to process
    });
  }
}
