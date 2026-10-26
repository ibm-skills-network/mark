import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import type { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { RolesGlobalGuard } from "src/auth/role/roles.global.guard";
import { Logger } from "winston";
import { UploadType } from "./dto/upload.dto";
import { FilesController } from "./files.controller";
import { FilesService } from "./services/files.service";
import { S3Service } from "./services/s3.service";

describe("FilesController direct upload", () => {
  const childLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const parentLogger = {
    child: jest.fn().mockReturnValue(childLogger),
  } as unknown as Logger;

  const mockFilesService = {
    resolveUploadTarget: jest.fn(),
    assertLearnerFileFitsQuestion: jest.fn().mockResolvedValue(undefined),
    assertUploadContextMatchesSession: jest.fn(),
    directUpload: jest.fn(),
  } as unknown as FilesService;

  const mockS3Service = {} as unknown as S3Service;

  let controller: FilesController;

  const file = {
    buffer: Buffer.from("hello"),
    size: 5,
    mimetype: "text/plain",
    originalname: "answer.txt",
  } as Express.Multer.File;

  const request = {
    userSession: {
      userId: "learner@example.com",
      role: UserRole.LEARNER,
    },
  } as unknown as UserSessionRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new FilesController(
      mockFilesService,
      mockS3Service,
      parentLogger,
    );
    (mockFilesService.resolveUploadTarget as jest.Mock).mockReturnValue({
      bucket: "learner-bucket",
      key: "42/learner@example.com/7/abc-answer.txt",
      fileName: "answer.txt",
      fileType: "text/plain",
      fileSize: 5,
      uploadType: UploadType.LEARNER,
      maxAllowedBytes: 100 * 1024 * 1024,
    });
    (mockFilesService.directUpload as jest.Mock).mockResolvedValue({
      success: true,
      key: "42/learner@example.com/7/abc-answer.txt",
      bucket: "learner-bucket",
      etag: '"etag-1"',
    });
  });

  it("stores the file and reports the storage location", async () => {
    const result = await controller.directUpload(
      file,
      {
        uploadType: UploadType.LEARNER,
        context: JSON.stringify({ assignmentId: 42, questionId: 7 }),
        source: "fallback",
      },
      request,
    );

    expect(mockFilesService.resolveUploadTarget).toHaveBeenCalledWith(
      {
        fileName: "answer.txt",
        fileType: "text/plain",
        // The buffered length, never a client-declared size.
        fileSize: 5,
        uploadType: UploadType.LEARNER,
        context: { assignmentId: 42, questionId: 7 },
      },
      "learner@example.com",
      UserRole.LEARNER,
    );
    expect(result).toEqual({
      success: true,
      key: "42/learner@example.com/7/abc-answer.txt",
      bucket: "learner-bucket",
      fileType: "text/plain",
      fileName: "answer.txt",
      uploadType: UploadType.LEARNER,
      size: 5,
      etag: '"etag-1"',
    });
  });

  it("logs the route taken so fallback volume is observable", async () => {
    await controller.directUpload(
      file,
      { uploadType: UploadType.LEARNER, source: "fallback" },
      request,
    );

    expect(childLogger.info).toHaveBeenCalledWith(
      "direct_upload_start",
      expect.objectContaining({ source: "fallback", size_bytes: 5 }),
    );
    expect(childLogger.info).toHaveBeenCalledWith(
      "direct_upload_complete",
      expect.objectContaining({ source: "fallback" }),
    );
  });

  it("defaults the route label when the client omits it", async () => {
    await controller.directUpload(
      file,
      { uploadType: UploadType.LEARNER },
      request,
    );

    expect(childLogger.info).toHaveBeenCalledWith(
      "direct_upload_start",
      expect.objectContaining({ source: "direct" }),
    );
  });

  it("logs and rethrows when the storage write fails", async () => {
    (mockFilesService.directUpload as jest.Mock).mockRejectedValue(
      new Error("storage down"),
    );

    await expect(
      controller.directUpload(
        file,
        { uploadType: UploadType.LEARNER },
        request,
      ),
    ).rejects.toThrow("storage down");

    expect(childLogger.error).toHaveBeenCalledWith(
      "direct_upload_failed",
      expect.objectContaining({ error: "storage down" }),
    );
  });

  it("rejects a request with no file", async () => {
    await expect(
      controller.directUpload(
        undefined as unknown as Express.Multer.File,
        { uploadType: UploadType.LEARNER },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockFilesService.directUpload).not.toHaveBeenCalled();
  });

  it("rejects a file its question does not accept before storing it", async () => {
    (
      mockFilesService.assertLearnerFileFitsQuestion as jest.Mock
    ).mockRejectedValueOnce(
      new BadRequestException("This question doesn't accept .ipynb files."),
    );

    await expect(
      controller.directUpload(
        file,
        {
          uploadType: UploadType.LEARNER,
          context: '{"assignmentId":2688,"questionId":8645}',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockFilesService.assertLearnerFileFitsQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: file.originalname,
        uploadType: UploadType.LEARNER,
        context: expect.objectContaining({
          assignmentId: 2688,
          questionId: 8645,
        }),
      }),
      expect.any(String),
      expect.anything(),
    );
    expect(mockFilesService.directUpload).not.toHaveBeenCalled();
  });

  it("passes authorization failures straight through", async () => {
    (mockFilesService.resolveUploadTarget as jest.Mock).mockImplementation(
      () => {
        throw new ForbiddenException();
      },
    );

    await expect(
      controller.directUpload(file, { uploadType: UploadType.AUTHOR }, request),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockFilesService.directUpload).not.toHaveBeenCalled();
  });

  describe("hostile context payloads", () => {
    const rejected: Array<[string, string]> = [
      ["malformed JSON", "{not json"],
      ["a JSON null", "null"],
      ["a JSON array", "[1,2,3]"],
      ["a JSON string", '"authors/"'],
      ["a wrongly typed field", '{"assignmentId":"42"}'],
      ["a wrongly typed path", '{"path":42}'],
    ];

    it.each(rejected)(
      "rejects %s with a generic error",
      async (_l, context) => {
        await expect(
          controller.directUpload(
            file,
            { uploadType: UploadType.LEARNER, context },
            request,
          ),
        ).rejects.toMatchObject({ message: "Invalid upload context" });

        expect(mockFilesService.directUpload).not.toHaveBeenCalled();
      },
    );

    it("never echoes the rejected payload back to the caller", async () => {
      await expect(
        controller.directUpload(
          file,
          { uploadType: UploadType.LEARNER, context: '{"path":42}' },
          request,
        ),
      ).rejects.toMatchObject({ message: "Invalid upload context" });

      expect(childLogger.warn).toHaveBeenCalledWith(
        "direct_upload_rejected: context failed validation",
        expect.objectContaining({ denial_reason: "context_invalid" }),
      );
    });
  });
});

describe("FilesController file access", () => {
  const childLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const parentLogger = {
    child: jest.fn().mockReturnValue(childLogger),
  } as unknown as Logger;

  const getSignedUrl = jest.fn();
  const mockS3Service = {
    isConfiguredUploadBucket: jest.fn().mockReturnValue(true),
    headObject: jest
      .fn()
      .mockResolvedValue({ ContentLength: 10, LastModified: new Date(0) }),
    getSignedUrl,
  } as unknown as S3Service;

  const request = {
    userSession: {
      userId: "learner@example.com",
      role: UserRole.LEARNER,
    },
  } as unknown as UserSessionRequest;

  let controller: FilesController;

  beforeEach(() => {
    jest.clearAllMocks();
    getSignedUrl.mockResolvedValue("https://signed.example/object");
    controller = new FilesController(
      {} as unknown as FilesService,
      mockS3Service,
      parentLogger,
    );
  });

  it("names downloads after the original upload, not the storage key", async () => {
    const result = await controller.getFileAccess(
      "2537/learner@example.com/26293/munx8fz6ywtb03w6lm-Fleet_END.XLSX",
      "learner-bucket",
      "3600",
      request,
    );

    expect(result.filename).toBe("Fleet_END.XLSX");
    const dispositions = getSignedUrl.mock.calls.map(
      (call: [string, { ResponseContentDisposition: string }]) =>
        call[1].ResponseContentDisposition,
    );
    expect(dispositions).toEqual([
      `inline; filename="Fleet_END.XLSX"; filename*=UTF-8''Fleet_END.XLSX`,
      `attachment; filename="Fleet_END.XLSX"; filename*=UTF-8''Fleet_END.XLSX`,
    ]);
  });

  it("encodes quotes and control characters instead of interpolating them", async () => {
    await controller.getFileAccess(
      'learner@example.com/munx8fz6ywtb03w6lm-a"b.txt',
      "learner-bucket",
      "3600",
      request,
    );

    const attachment = getSignedUrl.mock.calls[1][1] as {
      ResponseContentDisposition: string;
    };
    expect(attachment.ResponseContentDisposition).toBe(
      `attachment; filename="a_b.txt"; filename*=UTF-8''a%22b.txt`,
    );
  });
});

describe("FilesController learner ownership checks", () => {
  const childLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const parentLogger = {
    child: jest.fn().mockReturnValue(childLogger),
  } as unknown as Logger;

  const getSignedUrl = jest.fn();
  const mockS3Service = {
    isConfiguredUploadBucket: jest.fn().mockReturnValue(true),
    headObject: jest
      .fn()
      .mockResolvedValue({ ContentLength: 10, LastModified: new Date(0) }),
    getSignedUrl,
  } as unknown as S3Service;

  const mockFilesService = {
    assertUploadContextMatchesSession: jest.fn(),
    generateUploadUrl: jest.fn().mockResolvedValue({ key: "k" }),
    initiateMultipartUpload: jest.fn().mockResolvedValue({ uploadId: "u" }),
    assertDeleteAllowed: jest.fn(),
    deleteFile: jest.fn().mockResolvedValue({ success: true }),
    generatePublicUrl: jest
      .fn()
      .mockResolvedValue({ presignedUrl: "https://signed.example/public" }),
  };

  const request = {
    userSession: {
      userId: "learner@example.com",
      role: UserRole.LEARNER,
      assignmentId: 42,
    },
  } as unknown as UserSessionRequest;

  let controller: FilesController;

  beforeEach(() => {
    jest.clearAllMocks();
    getSignedUrl.mockResolvedValue("https://signed.example/object");
    controller = new FilesController(
      mockFilesService as unknown as FilesService,
      mockS3Service,
      parentLogger,
    );
  });

  const uploadRequest = {
    fileName: "a.pdf",
    fileType: "application/pdf",
    fileSize: 10,
    uploadType: UploadType.LEARNER,
    context: { assignmentId: 43, questionId: 7 },
  };

  it("checks the upload context against the session before presigning", async () => {
    mockFilesService.assertUploadContextMatchesSession.mockImplementationOnce(
      () => {
        throw new ForbiddenException();
      },
    );

    await expect(
      controller.generateUploadUrl(uploadRequest, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockFilesService.generateUploadUrl).not.toHaveBeenCalled();
  });

  it("checks the upload context against the session before a multipart upload starts", async () => {
    mockFilesService.assertUploadContextMatchesSession.mockImplementationOnce(
      () => {
        throw new ForbiddenException();
      },
    );

    await expect(
      controller.initiateMultipartUpload(uploadRequest, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockFilesService.initiateMultipartUpload).not.toHaveBeenCalled();
  });

  it("checks ownership before deleting", async () => {
    mockFilesService.assertDeleteAllowed.mockImplementationOnce(() => {
      throw new NotFoundException();
    });

    await expect(
      controller.deleteFile(
        "delete",
        "learner",
        request,
        "42/other@example.com/7/a.pdf",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockFilesService.deleteFile).not.toHaveBeenCalled();
  });

  it("deletes the learner's own upload", async () => {
    await controller.deleteFile(
      "delete",
      "learner",
      request,
      "42/learner@example.com/7/a.pdf",
    );

    expect(mockFilesService.assertDeleteAllowed).toHaveBeenCalledWith(
      "learner",
      "42/learner@example.com/7/a.pdf",
      request.userSession,
    );
    expect(mockFilesService.deleteFile).toHaveBeenCalled();
  });

  it("signs a public URL only for a key the caller owns", async () => {
    await expect(
      controller.getPublicUrl("42/learner@example.com/7/a.pdf", request),
    ).resolves.toEqual({ presignedUrl: "https://signed.example/public" });

    await expect(
      controller.getPublicUrl("42/other@example.com/7/a.pdf", request),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockFilesService.generatePublicUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["3600", 900],
    ["120", 120],
    ["not-a-number", 900],
    ["-5", 900],
  ])("caps access URL expiry: %s -> %d s", async (requested, expected) => {
    await controller.getFileAccess(
      "42/learner@example.com/7/abc-a.pdf",
      "learner-bucket",
      requested,
      request,
    );

    for (const call of getSignedUrl.mock.calls as [
      string,
      { Expires: number },
    ][]) {
      expect(call[1].Expires).toBe(expected);
    }
  });
});

describe("FilesController file-management routes are author and admin only", () => {
  const guard = new RolesGlobalGuard(new Reflector(), {
    child: () => ({ warn: jest.fn() }),
  } as unknown as Logger);

  const contextFor = (
    handler: (...arguments_: never[]) => unknown,
    role: UserRole,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => FilesController,
      switchToHttp: () => ({
        getRequest: () => ({
          userSession: { role, userId: "someone@example.com" },
        }),
      }),
    }) as unknown as ExecutionContext;

  const routes = [
    ["PUT move", FilesController.prototype.moveFile],
    ["PUT rename", FilesController.prototype.renameFile],
    ["POST folder", FilesController.prototype.createFolder],
    ["DELETE folder", FilesController.prototype.deleteFolder],
    ["GET list", FilesController.prototype.listFiles],
    ["GET empty-folders", FilesController.prototype.listEmptyFolders],
  ] as const;

  it.each(routes)("refuses a learner on %s", (_label, handler) => {
    expect(guard.canActivate(contextFor(handler, UserRole.LEARNER))).toBe(
      false,
    );
  });

  it.each(routes)("admits authors and admins on %s", (_label, handler) => {
    expect(guard.canActivate(contextFor(handler, UserRole.AUTHOR))).toBe(true);
    expect(guard.canActivate(contextFor(handler, UserRole.ADMIN))).toBe(true);
  });

  it("registers DELETE folder before DELETE :fileId so it is reachable", () => {
    const order = Object.getOwnPropertyNames(FilesController.prototype);
    expect(order.indexOf("deleteFolder")).toBeLessThan(
      order.indexOf("deleteFile"),
    );
  });

  it("passes the caller's session to the service", async () => {
    const moveFile = jest.fn().mockResolvedValue({ success: true });
    const controller = new FilesController(
      { moveFile } as unknown as FilesService,
      {} as S3Service,
      { child: () => ({ info: jest.fn() }) } as unknown as Logger,
    );
    const session = { userId: "author@example.com", role: UserRole.AUTHOR };
    const body = {
      uploadType: UploadType.AUTHOR,
      sourceKey: "authors/author@example.com/a.pdf",
      targetPath: "/authors/author@example.com/sub",
    };
    await controller.moveFile(body, {
      userSession: session,
    } as unknown as UserSessionRequest);
    expect(moveFile).toHaveBeenCalledWith(body, session);
  });
});
