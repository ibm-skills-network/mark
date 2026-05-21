import { BadRequestException } from "@nestjs/common";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/database/prisma.service";
import { UploadType } from "../dto/upload.dto";
import { FileProcessingBudgetService } from "./file-processing-budget.service";
import { FilesService } from "./files.service";
import { S3Service } from "./s3.service";

describe("FilesService", () => {
  let service: FilesService;

  const mockS3Service = {
    getBucketName: jest.fn(),
    getBucketRegion: jest.fn(),
    getSignedUrl: jest.fn(),
    createMultipartUpload: jest.fn(),
    completeMultipartUpload: jest.fn(),
    headObject: jest.fn(),
    putObject: jest.fn(),
    deleteObject: jest.fn(),
    listObjectsV2: jest.fn(),
    deleteObjects: jest.fn(),
    copyObject: jest.fn(),
  } as unknown as S3Service;

  const mockPrismaService = {
    fileUpload: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 0 },
        _sum: { sizeBytes: null },
      }),
    },
  } as unknown as PrismaService;

  const mockBudget = {
    tryAcquire: jest.fn().mockReturnValue(true),
    acquire: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    buildBusyException: jest.fn(),
    getStatus: jest
      .fn()
      .mockReturnValue({ budget: 1024 * 1024 * 1024, inflight: 0, waiters: 0 }),
  } as unknown as FileProcessingBudgetService;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockBudget.tryAcquire as jest.Mock).mockReturnValue(true);
    service = new FilesService(mockS3Service, mockPrismaService, mockBudget);
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
        fileSize: 1024,
        uploadType: UploadType.LEARNER,
        context: {
          assignmentId: 42,
          questionId: 7,
        },
      },
      "user-123",
      UserRole.LEARNER,
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
        ContentLength: 1024,
        Expires: 600,
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
          fileSize: 1024,
          uploadType: UploadType.LEARNER,
          context: {
            questionId: 9,
          },
        },
        "user-123",
        UserRole.LEARNER,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects upload requests with traversal in context.path", async () => {
    // Order matters: mock getBucketName so the bucket check at
    // files.service.ts:73 does NOT pre-empt the sanitizer test.
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
    };
    s3.getBucketName.mockReturnValue("learner-bucket");

    await expect(
      service.generateUploadUrl(
        {
          fileName: "x.txt",
          fileType: "text/plain",
          uploadType: UploadType.LEARNER,
          context: { path: "../../../etc", assignmentId: 1, questionId: 1 },
        },
        "user-123",
        UserRole.LEARNER,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects upload requests with null byte in context.path", async () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
    };
    s3.getBucketName.mockReturnValue("learner-bucket");

    await expect(
      service.generateUploadUrl(
        {
          fileName: "x.txt",
          fileType: "text/plain",
          fileSize: 1024,
          uploadType: UploadType.LEARNER,
          context: { path: "abc\0def", assignmentId: 1, questionId: 1 },
        },
        "user-123",
        UserRole.LEARNER,
      ),
    ).rejects.toThrow(/Invalid upload path/);
  });

  it("rejects learner upload with context.path set but no assignmentId/questionId", async () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
    };
    s3.getBucketName.mockReturnValue("learner-bucket");

    await expect(
      service.generateUploadUrl(
        {
          fileName: "submission.txt",
          fileType: "text/plain",
          fileSize: 1024,
          uploadType: UploadType.LEARNER,
          context: { path: "chatbot/abc123" },
        },
        "user-123",
        UserRole.LEARNER,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("chatbot upload routes to the learner bucket with a server-controlled prefix", async () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
      getSignedUrl: jest.Mock;
    };
    s3.getBucketName.mockReturnValue("learner-bucket");
    s3.getSignedUrl.mockResolvedValue("https://signed-upload-url");

    const result = await service.generateUploadUrl(
      {
        fileName: "chat-file.pdf",
        fileType: "application/pdf",
        fileSize: 2048,
        uploadType: UploadType.CHATBOT,
      },
      "user-456",
      UserRole.LEARNER,
    );

    expect(result.bucket).toBe("learner-bucket");
    expect(result.key).toMatch(/^chatbot\/user-456\/.+-chat-file\.pdf$/);
    expect(s3.getBucketName).toHaveBeenCalledWith(UploadType.CHATBOT);
  });

  it("rejects chatbot uploads with unsupported MIME types", async () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
    };
    s3.getBucketName.mockReturnValue("learner-bucket");

    await expect(
      service.generateUploadUrl(
        {
          fileName: "payload.exe",
          fileType: "application/x-msdownload",
          fileSize: 2048,
          uploadType: UploadType.CHATBOT,
        },
        "user-456",
        UserRole.LEARNER,
      ),
    ).rejects.toThrow("Unsupported file extension for chatbot upload.");
  });

  it("rejects chatbot uploads when MIME type and extension do not match", async () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
    };
    s3.getBucketName.mockReturnValue("learner-bucket");

    await expect(
      service.generateUploadUrl(
        {
          fileName: "notes.pdf",
          fileType: "text/plain",
          fileSize: 2048,
          uploadType: UploadType.CHATBOT,
        },
        "user-456",
        UserRole.LEARNER,
      ),
    ).rejects.toThrow(
      "File extension does not match the provided MIME type for chatbot upload.",
    );
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

  it("initiates multipart uploads with one signed URL per part", async () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
      createMultipartUpload: jest.Mock;
      getSignedUrl: jest.Mock;
    };
    s3.getBucketName.mockReturnValue("learner-bucket");
    s3.createMultipartUpload.mockResolvedValue({ UploadId: "upload-123" });
    s3.getSignedUrl
      .mockResolvedValueOnce("https://part-1")
      .mockResolvedValueOnce("https://part-2");

    const result = await service.initiateMultipartUpload(
      {
        fileName: "submission.txt",
        fileType: "text/plain",
        fileSize: 6 * 1024 * 1024,
        uploadType: UploadType.LEARNER,
        context: {
          assignmentId: 42,
          questionId: 7,
        },
      },
      "user-123",
      UserRole.LEARNER,
    );

    expect(result.uploadId).toBe("upload-123");
    expect(result.urls).toHaveLength(2);
    expect(result.urls[0]).toEqual({
      partNumber: 1,
      url: "https://part-1",
    });
    expect(s3.createMultipartUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "learner-bucket",
        Key: result.key,
        ContentType: "text/plain",
      }),
    );
    expect(s3.getSignedUrl).toHaveBeenCalledWith(
      "uploadPart",
      expect.objectContaining({
        Bucket: "learner-bucket",
        Key: result.key,
        UploadId: "upload-123",
        PartNumber: 1,
      }),
    );
  });

  it("completes multipart uploads with uploaded parts", async () => {
    const s3 = mockS3Service as unknown as {
      getBucketName: jest.Mock;
      completeMultipartUpload: jest.Mock;
      headObject: jest.Mock;
    };
    const prisma = mockPrismaService as unknown as {
      fileUpload: {
        findUnique: jest.Mock;
        deleteMany: jest.Mock;
      };
    };
    s3.getBucketName.mockReturnValue("author-bucket");
    s3.completeMultipartUpload.mockResolvedValue({ ETag: '"etag-final"' });
    s3.headObject.mockResolvedValue({ ContentLength: 1024 });
    prisma.fileUpload.findUnique.mockResolvedValue({
      uploadId: "upload-123",
      userId: "user-123",
      storageKey: "authors/user-123/file.txt",
      bucket: "author-bucket",
      uploadType: UploadType.AUTHOR,
    });
    prisma.fileUpload.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.completeMultipartUpload(
      {
        uploadId: "upload-123",
        key: "authors/user-123/file.txt",
        uploadType: UploadType.AUTHOR,
        parts: [{ partNumber: 1, etag: '"etag-1"' }],
      },
      "user-123",
    );

    expect(s3.completeMultipartUpload).toHaveBeenCalledWith({
      Bucket: "author-bucket",
      Key: "authors/user-123/file.txt",
      UploadId: "upload-123",
      MultipartUpload: {
        Parts: [{ ETag: '"etag-1"', PartNumber: 1 }],
      },
    });
    expect(result).toEqual({
      success: true,
      key: "authors/user-123/file.txt",
      bucket: "author-bucket",
      uploadId: "upload-123",
      etag: '"etag-final"',
    });
  });
});
