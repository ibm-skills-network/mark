import { BadRequestException } from "@nestjs/common";
import { UploadType } from "../dto/upload.dto";
import { FilesService } from "./files.service";
import { S3Service } from "./s3.service";

describe("FilesService", () => {
  let service: FilesService;

  const mockS3Service = {
    getBucketName: jest.fn(),
    getBucketRegion: jest.fn(),
    getSignedUrl: jest.fn(),
    putObject: jest.fn(),
    deleteObject: jest.fn(),
    listObjectsV2: jest.fn(),
    deleteObjects: jest.fn(),
    copyObject: jest.fn(),
  } as unknown as S3Service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FilesService(mockS3Service);
  });

  it("generates learner upload URLs with assignment/user/question prefix", async () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
      getSignedUrl: jest.Mock;
    };
    s3.getBucketName.mockReturnValue("learner-bucket");
    s3.getSignedUrl.mockResolvedValue("https://signed-upload-url");

    const result = await service.generateUploadUrl(
      {
        fileName: "submission.txt",
        fileType: "text/plain",
        uploadType: UploadType.LEARNER,
        context: {
          assignmentId: 42,
          questionId: 7,
        },
      },
      "user-123",
    );

    expect(result.presignedUrl).toBe("https://signed-upload-url");
    expect(result.bucket).toBe("learner-bucket");
    expect(result.key).toMatch(/^42\/user-123\/7\/.+-submission\.txt$/);
    expect(s3.getSignedUrl).toHaveBeenCalledWith(
      "putObject",
      expect.objectContaining({
        Bucket: "learner-bucket",
        Key: result.key,
        ContentType: "text/plain",
        Expires: 300,
      }),
    );
  });

  it("rejects learner upload requests that miss assignmentId", async () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
    };
    s3.getBucketName.mockReturnValue("learner-bucket");

    await expect(
      service.generateUploadUrl(
        {
          fileName: "submission.txt",
          fileType: "text/plain",
          uploadType: UploadType.LEARNER,
          context: {
            questionId: 9,
          },
        },
        "user-123",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("generates public read URLs from the public bucket", async () => {
    process.env.S3_PUBLIC_BUCKET = "public-bucket";
    const s3 = mockS3Service as unknown as {
      getSignedUrl: jest.Mock;
    };
    s3.getSignedUrl.mockResolvedValue("https://signed-read-url");

    const result = await service.generatePublicUrl("reports/report-1.pdf");

    expect(result).toEqual({ presignedUrl: "https://signed-read-url" });
    expect(s3.getSignedUrl).toHaveBeenCalledWith("getObject", {
      Bucket: "public-bucket",
      Key: "reports/report-1.pdf",
      Expires: 3600,
    });
  });

  it("routes learner bucket requests to learner-prod in production mode", () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
    };
    s3.getBucketName.mockImplementation((uploadType: string) => {
      if (uploadType === UploadType.LEARNER_PROD) return "learner-prod-bucket";
      if (uploadType === UploadType.LEARNER) return "learner-bucket";
      return "other";
    });

    const bucket = service.getBucketForEnvironment(UploadType.LEARNER, true);

    expect(bucket).toBe("learner-prod-bucket");
    expect(s3.getBucketName).toHaveBeenCalledWith(UploadType.LEARNER_PROD);
  });
});
