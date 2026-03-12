import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
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
      service.getSignedUrl("deleteObject", {
        Bucket: "author-bucket",
        Key: "file.txt",
      }),
    ).rejects.toThrow("Unsupported signed URL operation: deleteObject");
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
});
