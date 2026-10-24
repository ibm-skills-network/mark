import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
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
    question: {
      // A report-style question accepts documents and images.
      findFirst: jest
        .fn()
        .mockResolvedValue({ type: "UPLOAD", responseType: "REPORT" }),
    },
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

  describe("hostile upload context", () => {
    it.each([
      ["null", null],
      ["an array", []],
      ["a string", "authors/"],
      ["a number", 7],
    ])(
      "treats %s as an absent context instead of crashing",
      (_label, value) => {
        const s3 = mockS3Service as unknown as { getBucketName: jest.Mock };
        s3.getBucketName.mockReturnValue("author-bucket");

        const result = service.resolveUploadTarget(
          {
            fileName: "notes.txt",
            fileType: "text/plain",
            fileSize: 10,
            uploadType: UploadType.AUTHOR,
            context: value as never,
          },
          "user-123",
          UserRole.AUTHOR,
        );

        expect(result.key).toMatch(/^authors\/user-123\/.+-notes\.txt$/);
      },
    );
  });

  describe("direct upload", () => {
    const file = {
      buffer: Buffer.from("hello"),
      size: 5,
      mimetype: "text/plain",
      originalname: "hello.txt",
    } as Express.Multer.File;

    it("claims and releases processing budget around the storage write", async () => {
      const s3 = mockS3Service as unknown as { putObject: jest.Mock };
      s3.putObject.mockResolvedValue({ ETag: '"etag-direct"' });

      const result = await service.directUpload(
        file,
        "author-bucket",
        "authors/user-123/hello.txt",
      );

      expect(mockBudget.tryAcquire).toHaveBeenCalledWith(5);
      expect(mockBudget.release).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        success: true,
        key: "authors/user-123/hello.txt",
        bucket: "author-bucket",
        etag: '"etag-direct"',
      });
    });

    it("stores private with the client's type unless options say otherwise", async () => {
      const s3 = mockS3Service as unknown as { putObject: jest.Mock };
      s3.putObject.mockResolvedValue({ ETag: '"etag"' });

      await service.directUpload(file, "author-bucket", "a/plain.txt");
      expect(s3.putObject).toHaveBeenLastCalledWith({
        Bucket: "author-bucket",
        Key: "a/plain.txt",
        Body: file.buffer,
        ContentType: "text/plain",
      });

      await service.directUpload(file, "debug-bucket", "a/shot.png", {
        acl: "public-read",
        contentType: "image/png",
      });
      expect(s3.putObject).toHaveBeenLastCalledWith({
        Bucket: "debug-bucket",
        Key: "a/shot.png",
        Body: file.buffer,
        ContentType: "image/png",
        ACL: "public-read",
      });
    });

    it("releases the claim when the storage write fails", async () => {
      const s3 = mockS3Service as unknown as { putObject: jest.Mock };
      s3.putObject.mockRejectedValue(new Error("storage down"));

      await expect(
        service.directUpload(file, "author-bucket", "authors/user-123/x.txt"),
      ).rejects.toThrow("storage down");

      expect(mockBudget.release).toHaveBeenCalledWith(5);
    });

    it("refuses the upload when the pod budget is full", async () => {
      const s3 = mockS3Service as unknown as { putObject: jest.Mock };
      (mockBudget.tryAcquire as jest.Mock).mockReturnValue(false);
      (mockBudget.buildBusyException as jest.Mock).mockReturnValue(
        new ServiceUnavailableException({ status: "busy" }),
      );

      await expect(
        service.directUpload(file, "author-bucket", "authors/user-123/x.txt"),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(s3.putObject).not.toHaveBeenCalled();
      expect(mockBudget.release).not.toHaveBeenCalled();
    });
  });

  describe("learner file type must fit the question", () => {
    const prisma = mockPrismaService as unknown as {
      question: { findFirst: jest.Mock };
    };
    const request = (fileName: string) => ({
      fileName,
      fileType: "application/octet-stream",
      fileSize: 4833,
      uploadType: UploadType.LEARNER,
      context: { assignmentId: 2688, questionId: 8645 },
    });

    beforeEach(() => {
      const s3 = mockS3Service as unknown as {
        getBucketName: jest.Mock;
        getSignedUrl: jest.Mock;
      };
      s3.getBucketName.mockReturnValue("learner-bucket");
      s3.getSignedUrl.mockResolvedValue("https://signed-upload-url");
    });

    it("rejects a notebook on an image question before signing anything", async () => {
      prisma.question.findFirst.mockResolvedValueOnce({
        type: "UPLOAD",
        responseType: "IMAGES",
      });

      await expect(
        service.generateUploadUrl(
          request("DataScienceEcosystem.ipynb"),
          "learner@example.com",
          UserRole.LEARNER,
        ),
      ).rejects.toThrow(
        "This question doesn't accept .ipynb files. Allowed types: .png, .jpg, .jpeg, .gif, .webp.",
      );
      expect(prisma.question.findFirst).toHaveBeenCalledWith({
        where: { id: 8645, assignmentId: 2688, isDeleted: false },
        select: { type: true, responseType: true },
      });
      expect(
        (mockS3Service as unknown as { getSignedUrl: jest.Mock }).getSignedUrl,
      ).not.toHaveBeenCalled();
    });

    it("accepts an image on an image question, whatever the case of its extension", async () => {
      prisma.question.findFirst.mockResolvedValueOnce({
        type: "UPLOAD",
        responseType: "IMAGES",
      });

      await expect(
        service.generateUploadUrl(
          request("admin_login.PNG"),
          "learner@example.com",
          UserRole.LEARNER,
        ),
      ).resolves.toMatchObject({ bucket: "learner-bucket" });
    });

    it("rejects a question that is not in the named assignment", async () => {
      prisma.question.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.initiateMultipartUpload(
          request("admin_login.png"),
          "learner@example.com",
          UserRole.LEARNER,
        ),
      ).rejects.toThrow("Invalid upload context");
    });

    it("leaves a question with no type list unrestricted", async () => {
      prisma.question.findFirst.mockResolvedValueOnce({
        type: "UPLOAD",
        responseType: "VIDEO",
      });

      await expect(
        service.generateUploadUrl(
          request("talk.mp4"),
          "learner@example.com",
          UserRole.LEARNER,
        ),
      ).resolves.toMatchObject({ bucket: "learner-bucket" });
    });

    it("does not check author uploads", async () => {
      await service.assertLearnerFileFitsQuestion(
        request("anything.ipynb"),
        "author@example.com",
        UserRole.AUTHOR,
      );
      expect(prisma.question.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("upload file names", () => {
    it("keys an upload by the file's base name only", async () => {
      (mockS3Service.getBucketName as jest.Mock).mockReturnValue(
        "learner-bucket",
      );
      (mockS3Service.getSignedUrl as jest.Mock).mockResolvedValue("https://u");

      const result = await service.generateUploadUrl(
        {
          fileName: "../../other-user/evil\u0007.txt",
          fileType: "text/plain",
          fileSize: 10,
          uploadType: UploadType.LEARNER,
          context: { assignmentId: 42, questionId: 7 },
        },
        "user-123",
        UserRole.LEARNER,
      );

      expect(result.key).toMatch(/^42\/user-123\/7\/[^/]+-evil\.txt$/);
      expect(result.fileName).toBe("evil.txt");
    });

    it("rejects a name that is too long", () => {
      (mockS3Service.getBucketName as jest.Mock).mockReturnValue(
        "learner-bucket",
      );
      expect(() =>
        service.resolveUploadTarget(
          {
            fileName: `${"x".repeat(300)}.txt`,
            fileType: "text/plain",
            fileSize: 10,
            uploadType: UploadType.LEARNER,
            context: { assignmentId: 42, questionId: 7 },
          },
          "user-123",
          UserRole.LEARNER,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe("upload context must match the session", () => {
    const session = {
      userId: "learner@example.com",
      role: UserRole.LEARNER,
      assignmentId: 42,
    };

    it("allows a learner upload for the session's assignment", () => {
      expect(() =>
        service.assertUploadContextMatchesSession(
          {
            uploadType: UploadType.LEARNER,
            context: { assignmentId: 42, questionId: 7 },
          },
          session,
        ),
      ).not.toThrow();
    });

    it.each([
      ["another assignment", { assignmentId: 43, questionId: 7 }],
      ["no assignment", { questionId: 7 }],
      ["no context", undefined],
    ])("forbids a learner upload naming %s", (_label, context) => {
      expect(() =>
        service.assertUploadContextMatchesSession(
          { uploadType: UploadType.LEARNER_PROD, context },
          session,
        ),
      ).toThrow(ForbiddenException);
    });

    it("does not apply to author uploads or admins", () => {
      expect(() =>
        service.assertUploadContextMatchesSession(
          { uploadType: UploadType.AUTHOR, context: { assignmentId: 1 } },
          { ...session, role: UserRole.AUTHOR },
        ),
      ).not.toThrow();
      expect(() =>
        service.assertUploadContextMatchesSession(
          { uploadType: UploadType.LEARNER, context: { assignmentId: 1 } },
          { ...session, role: UserRole.ADMIN },
        ),
      ).not.toThrow();
    });
  });

  describe("who may delete", () => {
    const learner = {
      userId: "learner@example.com",
      role: UserRole.LEARNER,
      assignmentId: 42,
    };

    it.each([
      ["learner", "42/learner@example.com/7/a.pdf"],
      ["learner-prod", "42/learner@example.com/7/a.pdf"],
      ["chatbot", "chatbot/learner@example.com/a.png"],
    ])("lets a learner delete their own %s upload", (uploadType, key) => {
      expect(() =>
        service.assertDeleteAllowed(uploadType, key, learner),
      ).not.toThrow();
    });

    it.each([
      ["another learner's upload", "learner", "42/other@example.com/7/a.pdf"],
      [
        "another assignment's upload",
        "learner",
        "41/learner@example.com/7/a.pdf",
      ],
      ["an author file", "author", "authors/someone/a.pdf"],
      ["a debug file", "debug", "debug/1/a.log"],
      [
        "another user's chat file",
        "chatbot",
        "chatbot/other@example.com/a.png",
      ],
    ])("404s a learner deleting %s", (_label, uploadType, key) => {
      expect(() =>
        service.assertDeleteAllowed(uploadType, key, learner),
      ).toThrow(NotFoundException);
    });

    it("keeps authors to author files and their own chat files", () => {
      const author = { ...learner, role: UserRole.AUTHOR };
      expect(() =>
        service.assertDeleteAllowed("author", "authors/x/a.pdf", author),
      ).not.toThrow();
      expect(() =>
        service.assertDeleteAllowed(
          "learner",
          "42/learner@example.com/7/a.pdf",
          author,
        ),
      ).toThrow(NotFoundException);
    });
  });
});
