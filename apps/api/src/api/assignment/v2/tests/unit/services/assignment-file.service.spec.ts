/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AssignmentFileExtractionStatus,
  AssignmentFileStatus,
} from "@prisma/client";
import { FileContentExtractionService } from "src/api/attempt/services/file-content-extraction";
import { FilesService } from "src/api/files/services/files.service";
import { S3Service } from "src/api/files/services/s3.service";
import { PrismaService } from "src/database/prisma.service";
import { AssignmentFileService } from "../../../services/assignment-file.service";

const makeDbFile = (overrides = {}) => ({
  id: 1,
  assignmentId: 1,
  filename: "test.txt",
  mimeType: "text/plain",
  size: 100,
  storageKey: "assignments/1/files/uuid-test.txt",
  storageBucket: "test-bucket",
  status: AssignmentFileStatus.UPLOADING,
  uploadId: "upload-abc",
  extractionStatus: AssignmentFileExtractionStatus.PENDING,
  extractionError: null,
  extractedText: null,
  extractedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("AssignmentFileService", () => {
  let service: AssignmentFileService;
  let prisma: any;
  let s3: any;
  let extractor: any;
  let filesService: any;

  beforeEach(async () => {
    prisma = {
      assignmentFile: {
        create: jest.fn().mockResolvedValue(makeDbFile()),
        update: jest
          .fn()
          .mockResolvedValue(
            makeDbFile({ status: AssignmentFileStatus.READY, uploadId: null }),
          ),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };

    s3 = {
      getBucketName: jest.fn().mockReturnValue("test-bucket"),
      createMultipartUpload: jest
        .fn()
        .mockResolvedValue({ UploadId: "upload-abc" }),
      completeMultipartUpload: jest.fn().mockResolvedValue({}),
      objectExists: jest.fn().mockResolvedValue(false),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      getSignedUrl: jest
        .fn()
        .mockImplementation((_op, parameters) =>
          Promise.resolve(`https://s3/signed?part=${parameters.PartNumber}`),
        ),
      getObject: jest
        .fn()
        .mockResolvedValue({ Body: Buffer.from("file-bytes") }),
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    extractor = {
      extractContentFromFiles: jest.fn().mockResolvedValue([
        {
          filename: "test.txt",
          content: "extracted content",
          fileType: "text/plain",
          metadata: { size: 100 },
        },
      ]),
    };

    filesService = {
      validateUploadSize: jest.fn().mockReturnValue(100 * 1024 * 1024),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentFileService,
        { provide: PrismaService, useValue: prisma },
        { provide: S3Service, useValue: s3 },
        { provide: FileContentExtractionService, useValue: extractor },
        { provide: FilesService, useValue: filesService },
      ],
    }).compile();

    service = module.get<AssignmentFileService>(AssignmentFileService);
  });

  describe("initiateAssignmentFileUploads", () => {
    const makeItem = (overrides: Partial<any> = {}) => ({
      fileName: "test.txt",
      mimeType: "text/plain",
      fileSize: 6 * 1024 * 1024,
      ...overrides,
    });

    it("resolves bucket via author, creates MPU, presigns one URL per part, persists UPLOADING row", async () => {
      const dto = { files: [makeItem({ fileSize: 11 * 1024 * 1024 })] };

      const result = await service.initiateAssignmentFileUploads(
        1,
        dto as any,
        "user-1",
      );

      expect(s3.getBucketName).toHaveBeenCalledWith("author");
      expect(s3.createMultipartUpload).toHaveBeenCalledTimes(1);
      // 11 MB / 5 MB part → 3 parts (ceil)
      expect(s3.getSignedUrl).toHaveBeenCalledTimes(3);
      expect(s3.getSignedUrl.mock.calls[0][0]).toBe("uploadPart");
      expect(prisma.assignmentFile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignmentId: 1,
            status: AssignmentFileStatus.UPLOADING,
            extractionStatus: AssignmentFileExtractionStatus.PENDING,
            uploadId: "upload-abc",
            storageBucket: "test-bucket",
          }),
        }),
      );
      expect(result.uploads).toHaveLength(1);
      expect(result.uploads[0].urls).toHaveLength(3);
      expect(result.uploads[0].uploadId).toBe("upload-abc");
    });

    it("generates one presigned URL for files smaller than a part", async () => {
      const dto = { files: [makeItem({ fileSize: 1024 })] };

      const result = await service.initiateAssignmentFileUploads(
        1,
        dto as any,
        "user-1",
      );

      expect(result.uploads[0].urls).toHaveLength(1);
    });

    it("aborts the multipart upload on S3 when DB persist fails", async () => {
      prisma.assignmentFile.create.mockRejectedValue(new Error("db down"));

      await expect(
        service.initiateAssignmentFileUploads(
          1,
          { files: [makeItem()] } as any,
          "user-1",
        ),
      ).rejects.toThrow("db down");

      expect(s3.abortMultipartUpload).toHaveBeenCalledWith(
        expect.objectContaining({ UploadId: "upload-abc" }),
      );
    });

    it("throws BadRequestException when createMultipartUpload returns no UploadId", async () => {
      s3.createMultipartUpload.mockResolvedValue({});

      await expect(
        service.initiateAssignmentFileUploads(
          1,
          { files: [makeItem()] } as any,
          "user-1",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("completeAssignmentFileUpload", () => {
    const validDto = {
      uploadId: "upload-abc",
      parts: [{ partNumber: 1, etag: "etag-1" }],
    };

    it("throws NotFoundException when file does not exist", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(null);

      await expect(
        service.completeAssignmentFileUpload(1, 99, validDto as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when assignmentId mismatch", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(
        makeDbFile({ assignmentId: 2 }),
      );

      await expect(
        service.completeAssignmentFileUpload(1, 1, validDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when status is not UPLOADING", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(
        makeDbFile({ status: AssignmentFileStatus.READY }),
      );

      await expect(
        service.completeAssignmentFileUpload(1, 1, validDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when uploadId mismatch", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(
        makeDbFile({ uploadId: "upload-different" }),
      );

      await expect(
        service.completeAssignmentFileUpload(1, 1, validDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("completes MPU, extracts, marks READY, clears uploadId", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(makeDbFile());
      prisma.assignmentFile.update.mockResolvedValue(
        makeDbFile({
          status: AssignmentFileStatus.READY,
          extractionStatus: AssignmentFileExtractionStatus.READY,
          extractedText: "extracted content",
          extractedAt: new Date(),
          uploadId: null,
        }),
      );

      const result = await service.completeAssignmentFileUpload(
        1,
        1,
        validDto as any,
      );

      expect(s3.completeMultipartUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          UploadId: "upload-abc",
          MultipartUpload: {
            Parts: [{ PartNumber: 1, ETag: "etag-1" }],
          },
        }),
      );
      expect(extractor.extractContentFromFiles).toHaveBeenCalledTimes(1);
      expect(prisma.assignmentFile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            status: AssignmentFileStatus.READY,
            extractionStatus: AssignmentFileExtractionStatus.READY,
            uploadId: null,
          }),
        }),
      );
      expect(result.status).toBe(AssignmentFileStatus.READY);
    });

    it("marks the row FAILED and aborts S3 when multipart completion fails and no object exists", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(makeDbFile());
      s3.completeMultipartUpload.mockRejectedValue(
        new Error("complete failed"),
      );
      prisma.assignmentFile.update.mockResolvedValue(
        makeDbFile({
          status: AssignmentFileStatus.FAILED,
          extractionStatus: AssignmentFileExtractionStatus.FAILED,
          extractionError:
            "Multipart upload completion failed: complete failed",
          uploadId: null,
        }),
      );

      await expect(
        service.completeAssignmentFileUpload(1, 1, validDto as any),
      ).rejects.toThrow("complete failed");

      expect(s3.objectExists).toHaveBeenCalledWith(
        "test-bucket",
        "assignments/1/files/uuid-test.txt",
      );
      expect(s3.abortMultipartUpload).toHaveBeenCalledWith(
        expect.objectContaining({ UploadId: "upload-abc" }),
      );
      expect(prisma.assignmentFile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            status: AssignmentFileStatus.FAILED,
            extractionStatus: AssignmentFileExtractionStatus.FAILED,
            uploadId: null,
          }),
        }),
      );
    });

    it("continues when multipart completion throws but the assembled object already exists", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(makeDbFile());
      s3.completeMultipartUpload.mockRejectedValue(new Error("timeout"));
      s3.objectExists.mockResolvedValue(true);
      prisma.assignmentFile.update.mockResolvedValue(
        makeDbFile({
          status: AssignmentFileStatus.READY,
          extractionStatus: AssignmentFileExtractionStatus.READY,
          extractedText: "extracted content",
          extractedAt: new Date(),
          uploadId: null,
        }),
      );

      const result = await service.completeAssignmentFileUpload(
        1,
        1,
        validDto as any,
      );

      expect(s3.abortMultipartUpload).not.toHaveBeenCalled();
      expect(result.status).toBe(AssignmentFileStatus.READY);
    });

    it("persists extraction error and FAILED extractionStatus when extractor returns error", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(makeDbFile());
      extractor.extractContentFromFiles.mockResolvedValue([
        {
          filename: "test.txt",
          content: "[ERROR extracting test.txt]\n...",
          error: "parse error",
          fileType: "text/plain",
          metadata: { size: 0 },
        },
      ]);
      prisma.assignmentFile.update.mockResolvedValue(
        makeDbFile({
          status: AssignmentFileStatus.READY,
          extractionStatus: AssignmentFileExtractionStatus.FAILED,
          extractionError: "parse error",
          extractedText: null,
          extractedAt: null,
          uploadId: null,
        }),
      );

      const result = await service.completeAssignmentFileUpload(
        1,
        1,
        validDto as any,
      );

      expect(prisma.assignmentFile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AssignmentFileStatus.READY,
            extractionStatus: AssignmentFileExtractionStatus.FAILED,
            extractionError: "parse error",
            extractedText: null,
          }),
        }),
      );
      expect(result.extractionStatus).toBe(
        AssignmentFileExtractionStatus.FAILED,
      );
    });

    it("keeps the uploaded file READY when post-complete extraction throws", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(makeDbFile());
      extractor.extractContentFromFiles.mockRejectedValue(
        new Error("parser boom"),
      );
      prisma.assignmentFile.update.mockResolvedValue(
        makeDbFile({
          status: AssignmentFileStatus.READY,
          extractionStatus: AssignmentFileExtractionStatus.FAILED,
          extractionError: "Post-upload extraction failed: parser boom",
          extractedText: null,
          extractedAt: null,
          uploadId: null,
        }),
      );

      const result = await service.completeAssignmentFileUpload(
        1,
        1,
        validDto as any,
      );

      expect(prisma.assignmentFile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AssignmentFileStatus.READY,
            extractionStatus: AssignmentFileExtractionStatus.FAILED,
            extractionError: "Post-upload extraction failed: parser boom",
            uploadId: null,
          }),
        }),
      );
      expect(s3.deleteObject).not.toHaveBeenCalled();
      expect(result.status).toBe(AssignmentFileStatus.READY);
      expect(result.extractionStatus).toBe(
        AssignmentFileExtractionStatus.FAILED,
      );
    });

    it("strips NUL bytes from extracted content before persisting", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(makeDbFile());
      extractor.extractContentFromFiles.mockResolvedValue([
        {
          filename: "test.txt",
          content: "hel lo world",
          fileType: "text/plain",
          metadata: { size: 13 },
        },
      ]);
      prisma.assignmentFile.update.mockResolvedValue(
        makeDbFile({
          status: AssignmentFileStatus.READY,
          extractionStatus: AssignmentFileExtractionStatus.READY,
          extractedText: "helloworld",
          uploadId: null,
        }),
      );

      await service.completeAssignmentFileUpload(1, 1, validDto as any);

      expect(prisma.assignmentFile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            extractedText: "helloworld",
          }),
        }),
      );
    });

    it("recovers via raw SQL fallback when the first update throws — never leaves row stuck in UPLOADING", async () => {
      prisma.assignmentFile.findUnique
        .mockResolvedValueOnce(makeDbFile())
        .mockResolvedValueOnce(
          makeDbFile({
            status: AssignmentFileStatus.READY,
            extractionStatus: AssignmentFileExtractionStatus.FAILED,
            extractionError: "Extraction output rejected by storage layer",
            extractedText: null,
            uploadId: null,
          }),
        );
      prisma.assignmentFile.update.mockRejectedValueOnce(
        new Error("unexpected end of hex escape at line 1 column 226"),
      );
      prisma.$executeRaw = jest.fn().mockResolvedValue(1);

      const result = await service.completeAssignmentFileUpload(
        1,
        1,
        validDto as any,
      );

      expect(prisma.assignmentFile.update).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(AssignmentFileStatus.READY);
      expect(result.extractionStatus).toBe(
        AssignmentFileExtractionStatus.FAILED,
      );
    });
  });

  describe("abortAssignmentFileUpload", () => {
    it("throws NotFoundException when file does not exist", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(null);

      await expect(service.abortAssignmentFileUpload(1, 99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when assignmentId mismatch", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(
        makeDbFile({ assignmentId: 2 }),
      );

      await expect(service.abortAssignmentFileUpload(1, 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("calls S3 abort and deletes the DB row on happy path", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(makeDbFile());

      await service.abortAssignmentFileUpload(1, 1);

      expect(s3.abortMultipartUpload).toHaveBeenCalledWith(
        expect.objectContaining({ UploadId: "upload-abc" }),
      );
      expect(prisma.assignmentFile.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it("tolerates S3 abort failure and still deletes the DB row", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(makeDbFile());
      s3.abortMultipartUpload.mockRejectedValue(new Error("s3 timeout"));

      await expect(
        service.abortAssignmentFileUpload(1, 1),
      ).resolves.not.toThrow();

      expect(prisma.assignmentFile.delete).toHaveBeenCalledTimes(1);
    });

    it("throws BadRequestException when file is not in UPLOADING state", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(
        makeDbFile({ uploadId: null, status: AssignmentFileStatus.READY }),
      );

      await expect(service.abortAssignmentFileUpload(1, 1)).rejects.toThrow(
        BadRequestException,
      );

      expect(s3.abortMultipartUpload).not.toHaveBeenCalled();
      expect(prisma.assignmentFile.delete).not.toHaveBeenCalled();
    });
  });

  describe("deleteAssignmentFile", () => {
    it("throws NotFoundException when file does not exist", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(null);

      await expect(service.deleteAssignmentFile(1, 99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when file belongs to a different assignment", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(
        makeDbFile({ id: 1, assignmentId: 2 }),
      );

      await expect(service.deleteAssignmentFile(1, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("deletes from DB then attempts S3 delete on happy path", async () => {
      prisma.assignmentFile.findUnique.mockResolvedValue(
        makeDbFile({ id: 1, assignmentId: 1 }),
      );

      await service.deleteAssignmentFile(1, 1);

      expect(prisma.assignmentFile.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(s3.deleteObject).toHaveBeenCalledTimes(1);
    });
  });

  describe("cleanupAssignmentFileObjects", () => {
    it("does not throw when S3 delete fails — warns instead", async () => {
      prisma.assignmentFile.findMany.mockResolvedValue([
        { id: 1, storageKey: "key1", storageBucket: "bucket1" },
      ]);
      s3.deleteObject.mockRejectedValue(new Error("S3 network timeout"));

      await expect(
        service.cleanupAssignmentFileObjects(1),
      ).resolves.not.toThrow();
    });

    it("calls deleteObject for every file in the assignment", async () => {
      prisma.assignmentFile.findMany.mockResolvedValue([
        { id: 1, storageKey: "key1", storageBucket: "bucket1" },
        { id: 2, storageKey: "key2", storageBucket: "bucket1" },
      ]);

      await service.cleanupAssignmentFileObjects(1);

      expect(s3.deleteObject).toHaveBeenCalledTimes(2);
    });

    it("does nothing when assignment has no files", async () => {
      prisma.assignmentFile.findMany.mockResolvedValue([]);

      await service.cleanupAssignmentFileObjects(1);

      expect(s3.deleteObject).not.toHaveBeenCalled();
    });
  });
});
