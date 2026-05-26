import {
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Service } from "./s3.service";

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn(),
}));

describe("S3Service", () => {
  let service: S3Service;
  const mockGetSignedUrl = getS3SignedUrl as jest.MockedFunction<
    typeof getS3SignedUrl
  >;

  beforeEach(() => {
    process.env.IBM_COS_LEARNER_BUCKET_PROD = "learner-prod-bucket";
    process.env.IBM_COS_REGION = "us-east";
    process.env.IBM_COS_REGION_SOUTH = "us-south";
    service = new S3Service();
    mockGetSignedUrl.mockReset();
  });

  it("builds getObject signed URLs with explicit expiration", async () => {
    mockGetSignedUrl.mockResolvedValue("signed-get-url");

    const url = await service.getSignedUrl("getObject", {
      Bucket: "author-bucket",
      Key: "path/file.txt",
      Expires: 123,
      ResponseContentType: "text/plain",
    });

    expect(url).toBe("signed-get-url");
    const [client, command, options] = mockGetSignedUrl.mock.calls[0];
    const typedCommand = command as unknown as {
      input: Record<string, unknown>;
    };

    expect(client).toBe(
      (service as unknown as { s3ClientEast: unknown }).s3ClientEast,
    );
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(options).toEqual({ expiresIn: 123 });
    expect(typedCommand.input).toMatchObject({
      Bucket: "author-bucket",
      Key: "path/file.txt",
      ResponseContentType: "text/plain",
    });
    expect(typedCommand.input.Expires).toBeUndefined();
  });

  it("defaults putObject signed URL expiration to 900 seconds", async () => {
    mockGetSignedUrl.mockResolvedValue("signed-put-url");

    await service.getSignedUrl("putObject", {
      Bucket: "author-bucket",
      Key: "upload/file.txt",
      ContentType: "text/plain",
    });

    const [, command, options] = mockGetSignedUrl.mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(options).toEqual({ expiresIn: 900 });
  });

  it("throws on unsupported signed URL operation", async () => {
    await expect(
      // @ts-expect-error intentional invalid operation to verify runtime guard
      service.getSignedUrl("deleteObject", {
        Bucket: "author-bucket",
        Key: "file.txt",
      }),
    ).rejects.toThrow("Unsupported signed URL operation");
  });

  it("builds uploadPart signed URLs for multipart uploads", async () => {
    mockGetSignedUrl.mockResolvedValue("signed-upload-part-url");

    await service.getSignedUrl("uploadPart", {
      Bucket: "author-bucket",
      Key: "upload/file.txt",
      UploadId: "upload-123",
      PartNumber: 1,
      Expires: 456,
    });

    const [, command, options] = mockGetSignedUrl.mock.calls[0];
    expect(command).toBeInstanceOf(UploadPartCommand);
    expect(options).toEqual({ expiresIn: 456 });
  });

  it("returns false when objectExists receives a 404-style error", async () => {
    const sendMock = jest
      .fn()
      .mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
    (
      service as unknown as {
        s3ClientEast: { send: jest.Mock };
      }
    ).s3ClientEast = { send: sendMock };

    await expect(
      service.objectExists("author-bucket", "missing.txt"),
    ).resolves.toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows unexpected objectExists errors", async () => {
    const sendMock = jest.fn().mockRejectedValue(new Error("COS unavailable"));
    (
      service as unknown as {
        s3ClientEast: { send: jest.Mock };
      }
    ).s3ClientEast = { send: sendMock };

    await expect(
      service.objectExists("author-bucket", "file.txt"),
    ).rejects.toThrow("COS unavailable");
  });

  describe("getBucketName", () => {
    const envBackup = {
      author: process.env.IBM_COS_AUTHOR_BUCKET,
      learner: process.env.IBM_COS_LEARNER_BUCKET,
      learnerProd: process.env.IBM_COS_LEARNER_BUCKET_PROD,
      debug: process.env.IBM_COS_DEBUG_BUCKET,
    };

    afterEach(() => {
      process.env.IBM_COS_AUTHOR_BUCKET = envBackup.author;
      process.env.IBM_COS_LEARNER_BUCKET = envBackup.learner;
      process.env.IBM_COS_LEARNER_BUCKET_PROD = envBackup.learnerProd;
      process.env.IBM_COS_DEBUG_BUCKET = envBackup.debug;
    });

    it("returns the bucket for each known upload type", () => {
      process.env.IBM_COS_AUTHOR_BUCKET = "author-bkt";
      process.env.IBM_COS_LEARNER_BUCKET = "learner-bkt";
      process.env.IBM_COS_LEARNER_BUCKET_PROD = "learner-prod-bkt";
      process.env.IBM_COS_DEBUG_BUCKET = "debug-bkt";

      expect(service.getBucketName("author")).toBe("author-bkt");
      expect(service.getBucketName("learner")).toBe("learner-bkt");
      expect(service.getBucketName("learner-prod")).toBe("learner-prod-bkt");
      expect(service.getBucketName("debug")).toBe("debug-bkt");
    });

    it("throws BadRequestException with valid-types list for unknown upload type", () => {
      let caught: unknown;
      try {
        service.getBucketName("admin");
      } catch (error) {
        caught = error;
      }
      const error = caught as Error & { getStatus?: () => number };
      expect(error).toBeDefined();
      expect(error.message).toContain("Unknown upload type 'admin'");
      expect(error.message).toContain("author");
      expect(error.message).toContain("learner-prod");
      // BadRequestException maps to 400
      expect(error.getStatus?.()).toBe(400);
    });

    it("throws a server-error (not BadRequestException) naming the env var when bucket is unset", () => {
      delete process.env.IBM_COS_AUTHOR_BUCKET;

      let caught: unknown;
      try {
        service.getBucketName("author");
      } catch (error) {
        caught = error;
      }
      const error = caught as Error & { getStatus?: () => number };
      expect(error).toBeDefined();
      expect(error.message).toContain("IBM_COS_AUTHOR_BUCKET");
      expect(error.message).toContain("author");
      // Plain Error, not BadRequestException — this is a 5xx (server misconfig)
      expect(error.getStatus).toBeUndefined();
    });
  });

  describe("constructor env validation", () => {
    const envBackup = {
      nodeEnv: process.env.NODE_ENV,
      endpoint: process.env.IBM_COS_ENDPOINT,
      accessKeyId: process.env.IBM_COS_ACCESS_KEY_ID,
      secretAccessKey: process.env.IBM_COS_SECRET_ACCESS_KEY,
      region: process.env.IBM_COS_REGION,
    };

    afterEach(() => {
      process.env.NODE_ENV = envBackup.nodeEnv;
      process.env.IBM_COS_ENDPOINT = envBackup.endpoint;
      process.env.IBM_COS_ACCESS_KEY_ID = envBackup.accessKeyId;
      process.env.IBM_COS_SECRET_ACCESS_KEY = envBackup.secretAccessKey;
      process.env.IBM_COS_REGION = envBackup.region;
    });

    it("throws naming IBM_COS_ENDPOINT when missing in production", () => {
      process.env.NODE_ENV = "production";
      delete process.env.IBM_COS_ENDPOINT;
      process.env.IBM_COS_ACCESS_KEY_ID = "key";
      process.env.IBM_COS_SECRET_ACCESS_KEY = "secret";
      process.env.IBM_COS_REGION = "us-east";

      expect(() => new S3Service()).toThrow(/IBM_COS_ENDPOINT/);
    });

    it("throws naming IBM_COS_ACCESS_KEY_ID when missing in staging", () => {
      process.env.NODE_ENV = "staging";
      process.env.IBM_COS_ENDPOINT = "https://s3.example.com";
      delete process.env.IBM_COS_ACCESS_KEY_ID;
      process.env.IBM_COS_SECRET_ACCESS_KEY = "secret";
      process.env.IBM_COS_REGION = "us-east";

      expect(() => new S3Service()).toThrow(/IBM_COS_ACCESS_KEY_ID/);
    });

    it("succeeds in production when all four required vars are set", () => {
      process.env.NODE_ENV = "production";
      process.env.IBM_COS_ENDPOINT = "https://s3.example.com";
      process.env.IBM_COS_ACCESS_KEY_ID = "key";
      process.env.IBM_COS_SECRET_ACCESS_KEY = "secret";
      process.env.IBM_COS_REGION = "us-east";

      expect(() => new S3Service()).not.toThrow();
    });

    it("does not throw in development even when IBM_COS_ENDPOINT is missing", () => {
      process.env.NODE_ENV = "development";
      delete process.env.IBM_COS_ENDPOINT;

      expect(() => new S3Service()).not.toThrow();
    });
  });
});
