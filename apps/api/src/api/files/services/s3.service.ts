import { Injectable } from "@nestjs/common";
import { S3 } from "aws-sdk";

@Injectable()
export class S3Service {
  private s3ClientEast: S3;
  private s3ClientSouth: S3;

  constructor() {
    this.s3ClientEast = new S3({
      endpoint: process.env.IBM_COS_ENDPOINT ?? "",
      credentials: {
        accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY ?? "",
      },
      s3ForcePathStyle: true,
      signatureVersion: "v4",
      region: process.env.IBM_COS_REGION ?? "us-east",
    });

    this.s3ClientSouth = new S3({
      endpoint: process.env.IBM_COS_ENDPOINT_SOUTH ?? "",
      credentials: {
        accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID_SOUTH ?? "",
        secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY_SOUTH ?? "",
      },
      s3ForcePathStyle: true,
      signatureVersion: "v4",
      region: process.env.IBM_COS_REGION_SOUTH ?? "us-south",
    });
  }

  private getS3Client(bucket: string): S3 {
    if (bucket === process.env.IBM_COS_LEARNER_BUCKET_PROD) {
      return this.s3ClientSouth;
    }
    return this.s3ClientEast;
  }
  async getObjectMetadata(
    bucket: string,
    key: string,
  ): Promise<S3.HeadObjectOutput> {
    const client = this.getS3Client(bucket);
    return client.headObject({ Bucket: bucket, Key: key }).promise();
  }

  async headObject(
    parameters: S3.HeadObjectRequest,
  ): Promise<S3.HeadObjectOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.headObject(parameters).promise();
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      const client = this.getS3Client(bucket);
      await client.headObject({ Bucket: bucket, Key: key }).promise();
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
    const client = this.getS3Client(parameters.Bucket);
    return client.getObject(parameters).promise();
  }

  getSignedUrl(
    operation: string,
    parameters: {
      Bucket: string;
      Key: string;
      Expires?: number;
      [key: string]: any;
    },
  ): string {
    const bucket = parameters.Bucket;
    const client = this.getS3Client(bucket);
    return client.getSignedUrl(operation, parameters);
  }

  async putObject(
    parameters: S3.PutObjectRequest,
  ): Promise<S3.PutObjectOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.putObject(parameters).promise();
  }

  async deleteObject(
    parameters: S3.DeleteObjectRequest,
  ): Promise<S3.DeleteObjectOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.deleteObject(parameters).promise();
  }

  async deleteObjects(
    parameters: S3.DeleteObjectsRequest,
  ): Promise<S3.DeleteObjectsOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.deleteObjects(parameters).promise();
  }

  async copyObject(
    parameters: S3.CopyObjectRequest,
  ): Promise<S3.CopyObjectOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.copyObject(parameters).promise();
  }

  async listObjectsV2(
    parameters: S3.ListObjectsV2Request,
  ): Promise<S3.ListObjectsV2Output> {
    const client = this.getS3Client(parameters.Bucket);
    return client.listObjectsV2(parameters).promise();
  }

  async headBucket(parameters: S3.HeadBucketRequest): Promise<any> {
    const client = this.getS3Client(parameters.Bucket);
    return client.headBucket(parameters).promise();
  }

  getBucketName(uploadType: string): string | undefined {
    const buckets: Record<string, string> = {
      author: process.env.IBM_COS_AUTHOR_BUCKET ?? "",
      learner: process.env.IBM_COS_LEARNER_BUCKET ?? "",
      "learner-prod": process.env.IBM_COS_LEARNER_BUCKET_PROD ?? "",
      debug: process.env.IBM_COS_DEBUG_BUCKET ?? "",
    };
    if (buckets[uploadType]) {
      return buckets[uploadType];
    }
    throw new Error(`Bucket not found for upload type: ${uploadType}`);
  }

  /**
   * Get the region for a given bucket
   */
  getBucketRegion(bucket: string): string {
    if (bucket === process.env.IBM_COS_LEARNER_BUCKET_PROD) {
      return process.env.IBM_COS_REGION_SOUTH ?? "us-south";
    }
    return process.env.IBM_COS_REGION ?? "us-east";
  }
}
