import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import type { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
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
