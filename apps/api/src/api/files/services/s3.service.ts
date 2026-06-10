import { BadRequestException, Injectable } from "@nestjs/common";
import {
  AbortMultipartUploadCommand,
  AbortMultipartUploadCommandInput,
  AbortMultipartUploadCommandOutput,
  CompleteMultipartUploadCommand,
  CompleteMultipartUploadCommandInput,
  CompleteMultipartUploadCommandOutput,
  CopyObjectCommand,
  CopyObjectCommandInput,
  CopyObjectCommandOutput,
  CreateMultipartUploadCommand,
  CreateMultipartUploadCommandInput,
  CreateMultipartUploadCommandOutput,
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
  UploadPartCommand,
  UploadPartCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class S3Service {
  private s3ClientEast: S3Client;
  private s3ClientSouth: S3Client;

  // Fail fast in prod/staging — silent misconfig caused invalid host s3.us-east.amazonaws.com.
  private static assertRequiredCosEnvForProdLike(): void {
    const nodeEnvironment = process.env.NODE_ENV;
    if (nodeEnvironment !== "production" && nodeEnvironment !== "staging") {
      return;
    }
    const required = [
      "IBM_COS_ENDPOINT",
      "IBM_COS_ACCESS_KEY_ID",
      "IBM_COS_SECRET_ACCESS_KEY",
      "IBM_COS_REGION",
    ] as const;
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      throw new Error(
        `S3Service: missing required env var(s) for NODE_ENV=${nodeEnvironment}: ${missing.join(
          ", ",
        )}. Ensure these keys are present in the IBM COS credentials Secret mounted on this pod.`,
      );
    }
  }

  constructor() {
    S3Service.assertRequiredCosEnvForProdLike();

    const requestHandlerOptions = {
      connectionTimeout: 10_000,
      requestTimeout: 120_000,
    };

    this.s3ClientEast = new S3Client({
      endpoint: process.env.IBM_COS_ENDPOINT ?? "",
      credentials: {
        accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY ?? "",
      },
      forcePathStyle: true,
      region: process.env.IBM_COS_REGION ?? "us-east",
      requestHandler: requestHandlerOptions,
    });

    this.s3ClientSouth = new S3Client({
      endpoint: process.env.IBM_COS_ENDPOINT_SOUTH ?? "",
      credentials: {
        accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID_SOUTH ?? "",
        secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY_SOUTH ?? "",
      },
      forcePathStyle: true,
      region: process.env.IBM_COS_REGION_SOUTH ?? "us-south",
      requestHandler: requestHandlerOptions,
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
        typedError?.$metadata?.httpStatusCode === 404 ||
        typedError?.code === "NotFound" ||
        typedError?.name === "NotFound"
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
    operation: "getObject" | "putObject" | "uploadPart",
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

    if (operation === "uploadPart") {
      return getS3SignedUrl(
        client,
        new UploadPartCommand(commandParameters as UploadPartCommandInput),
        {
          expiresIn,
        },
      );
    }

    throw new Error("Unsupported signed URL operation");
  }

  async createMultipartUpload(
    parameters: CreateMultipartUploadCommandInput,
  ): Promise<CreateMultipartUploadCommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new CreateMultipartUploadCommand(parameters));
  }

  async completeMultipartUpload(
    parameters: CompleteMultipartUploadCommandInput,
  ): Promise<CompleteMultipartUploadCommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new CompleteMultipartUploadCommand(parameters));
  }

  async abortMultipartUpload(
    parameters: AbortMultipartUploadCommandInput,
  ): Promise<AbortMultipartUploadCommandOutput> {
    const client = this.getS3Client(parameters.Bucket);
    return client.send(new AbortMultipartUploadCommand(parameters));
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

  private static readonly BUCKET_ENV_VAR_BY_TYPE: Record<string, string> = {
    author: "IBM_COS_AUTHOR_BUCKET",
    learner: "IBM_COS_LEARNER_BUCKET",
    "learner-prod": "IBM_COS_LEARNER_BUCKET_PROD",
    debug: "IBM_COS_DEBUG_BUCKET",
    chatbot: "IBM_COS_LEARNER_BUCKET",
  };

  getBucketName(uploadType: string): string {
    const environmentVariable = S3Service.BUCKET_ENV_VAR_BY_TYPE[uploadType];
    if (!environmentVariable) {
      throw new BadRequestException(
        `Unknown upload type '${uploadType}'. Valid types: ${Object.keys(
          S3Service.BUCKET_ENV_VAR_BY_TYPE,
        ).join(", ")}`,
      );
    }
    const bucket = process.env[environmentVariable];
    if (!bucket) {
      throw new Error(
        `Bucket env var ${environmentVariable} is not set (upload type: '${uploadType}')`,
      );
    }
    return bucket;
  }

  /**
   * Check whether the supplied bucket name matches one of the configured
   * upload buckets. Used to reject arbitrary bucket names from query params
   * before any S3 call is made.
   */
  isConfiguredUploadBucket(bucket: string): boolean {
    if (!bucket) return false;
    const configured = new Set(
      Object.values(S3Service.BUCKET_ENV_VAR_BY_TYPE)
        .map((environmentVariable) => process.env[environmentVariable])
        .filter(Boolean),
    );
    return configured.has(bucket);
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
