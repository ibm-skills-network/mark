import { Injectable } from "@nestjs/common";
import { S3 } from "aws-sdk";

@Injectable()
export class S3Service {
  private s3Client: S3;

  constructor() {
    this.s3Client = new S3({
      endpoint: process.env.IBM_COS_ENDPOINT ?? "",
      credentials: {
        accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY ?? "",
      },
      s3ForcePathStyle: true,
      signatureVersion: "v4",
      region: process.env.IBM_COS_REGION ?? "us-east",
    });
  }
  async getObjectMetadata(
    bucket: string,
    key: string,
  ): Promise<S3.HeadObjectOutput> {
    return this.s3Client.headObject({ Bucket: bucket, Key: key }).promise();
  }
  async headObject(
    parameters: S3.HeadObjectRequest,
  ): Promise<S3.HeadObjectOutput> {
    return this.s3Client.headObject(parameters).promise();
  }
  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.s3Client.headObject({ Bucket: bucket, Key: key }).promise();
      return true;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "NotFound"
      ) {
        return false;
      }
      throw error;
    }
  }

  async getObject(
    parameters: S3.GetObjectRequest,
  ): Promise<S3.GetObjectOutput> {
    return this.s3Client.getObject(parameters).promise();
  }
  getSignedUrl(operation: string, parameters: any): string {
    return this.s3Client.getSignedUrl(operation, parameters);
  }

  async putObject(
    parameters: S3.PutObjectRequest,
  ): Promise<S3.PutObjectOutput> {
    return this.s3Client.putObject(parameters).promise();
  }

  async deleteObject(
    parameters: S3.DeleteObjectRequest,
  ): Promise<S3.DeleteObjectOutput> {
    return this.s3Client.deleteObject(parameters).promise();
  }

  async deleteObjects(
    parameters: S3.DeleteObjectsRequest,
  ): Promise<S3.DeleteObjectsOutput> {
    return this.s3Client.deleteObjects(parameters).promise();
  }

  async copyObject(
    parameters: S3.CopyObjectRequest,
  ): Promise<S3.CopyObjectOutput> {
    return this.s3Client.copyObject(parameters).promise();
  }

  async listObjectsV2(
    parameters: S3.ListObjectsV2Request,
  ): Promise<S3.ListObjectsV2Output> {
    return this.s3Client.listObjectsV2(parameters).promise();
  }

  async headBucket(parameters: S3.HeadBucketRequest): Promise<any> {
    return this.s3Client.headBucket(parameters).promise();
  }

  getBucketName(uploadType: string): string | undefined {
    const buckets: Record<string, string> = {
      author: process.env.IBM_COS_AUTHOR_BUCKET ?? "",
      learner: process.env.IBM_COS_LEARNER_BUCKET ?? "",
      debug: process.env.IBM_COS_DEBUG_BUCKET ?? "",
    };
    if (buckets[uploadType]) {
      return buckets[uploadType];
    }
    throw new Error(`Bucket not found for upload type: ${uploadType}`);
  }
}
