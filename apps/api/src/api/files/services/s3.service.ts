import { Injectable } from "@nestjs/common";
import {
  CopyObjectCommand,
  CopyObjectCommandInput,
  CopyObjectCommandOutput,
  DeleteObjectCommand,
  DeleteObjectCommandInput,
  DeleteObjectCommandOutput,
  DeleteObjectsCommand,
  DeleteObjectsCommandInput,
  DeleteObjectsCommandOutput,
  GetObjectCommand,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  HeadBucketCommand,
  HeadBucketCommandInput,
  HeadObjectCommand,
  HeadObjectCommandInput,
  HeadObjectCommandOutput,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
  PutObjectCommand,
  PutObjectCommandInput,
  PutObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class S3Service {
  private s3ClientEast: S3Client;
  private s3ClientSouth: S3Client;

  constructor() {
    this.s3ClientEast = new S3Client({
      endpoint: process.env.IBM_COS_ENDPOINT ?? "",
      credentials: {
        accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY ?? "",
      },
      forcePathStyle: true,
      region: process.env.IBM_COS_REGION ?? "us-east",
    });

    this.s3ClientSouth = new S3Client({
      endpoint: process.env.IBM_COS_ENDPOINT_SOUTH ?? "",
      credentials: {
        accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID_SOUTH ?? "",
        secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY_SOUTH ?? "",
      },
      forcePathStyle: true,
      region: process.env.IBM_COS_REGION_SOUTH ?? "us-south",
    });
  }

  private getS3Client(bucket: string): S3Client {
    if (bucket === process.env.IBM_COS_LEARNER_BUCKET_PROD) {
      return this.s3ClientSouth;
    }
    return this.s3ClientEast;
  }
  async getObjectMetadata(
    bucket: string,
    key: string,
  ): Promise<HeadObjectCommandOutput> {
    const client = this.getS3Client(bucket);
    return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  }

  async headObject(
    parameters: HeadObjectCommandInput,
  ): Promise<HeadObjectCommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new HeadObjectCommand(parameters));
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      const client = this.getS3Client(bucket);
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      const typedError = error as {
        code?: string;
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        typedError?.code === "NotFound" ||
        typedError?.name === "NotFound" ||
        typedError?.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  }

  async getObject(
    parameters: GetObjectCommandInput,
  ): Promise<GetObjectCommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new GetObjectCommand(parameters));
  }

  async getSignedUrl(
    operation: string,
    parameters: {
      Bucket: string;
      Key: string;
      Expires?: number;
      [key: string]: any;
    },
  ): Promise<string> {
    const bucket = parameters.Bucket;
    const client = this.getS3Client(bucket);
    const expiresIn = parameters.Expires ?? 900;
    const { Expires: _expires, ...commandParameters } = parameters;
    void _expires;

    if (operation === "getObject") {
      return getS3SignedUrl(client, new GetObjectCommand(commandParameters), {
        expiresIn,
      });
    }

    if (operation === "putObject") {
      return getS3SignedUrl(client, new PutObjectCommand(commandParameters), {
        expiresIn,
      });
    }

    throw new Error(`Unsupported signed URL operation: ${operation}`);
  }

  async putObject(
    parameters: PutObjectCommandInput,
  ): Promise<PutObjectCommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new PutObjectCommand(parameters));
  }

  async deleteObject(
    parameters: DeleteObjectCommandInput,
  ): Promise<DeleteObjectCommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new DeleteObjectCommand(parameters));
  }

  async deleteObjects(
    parameters: DeleteObjectsCommandInput,
  ): Promise<DeleteObjectsCommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new DeleteObjectsCommand(parameters));
  }

  async copyObject(
    parameters: CopyObjectCommandInput,
  ): Promise<CopyObjectCommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new CopyObjectCommand(parameters));
  }

  async listObjectsV2(
    parameters: ListObjectsV2CommandInput,
  ): Promise<ListObjectsV2CommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new ListObjectsV2Command(parameters));
  }

  async headBucket(parameters: HeadBucketCommandInput): Promise<any> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new HeadBucketCommand(parameters));
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
