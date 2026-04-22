/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AssignmentFileExtractionStatus,
  AssignmentFileStatus,
} from "@prisma/client";
import { FileContentExtractionService } from "src/api/attempt/services/file-content-extraction";
import { S3Service } from "src/api/files/services/s3.service";
import { PrismaService } from "src/database/prisma.service";
import { AssignmentFileService } from "../../../services/assignment-file.service";

const makeMulterFile = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    fieldname: "files",
    originalname: "test.txt",
    encoding: "7bit",
    mimetype: "text/plain",
    size: 100,
    buffer: Buffer.from("test content"),
    destination: "",
    filename: "",
    path: "",
    ...overrides,
  }) as Express.Multer.File;

const makeDbFile = (overrides = {}) => ({
  id: 1,
  assignmentId: 1,
  filename: "test.txt",
  mimeType: "text/plain",
  size: 100,
  storageKey: "assignments/1/files/uuid-test.txt",
  storageBucket: "test-bucket",
  status: AssignmentFileStatus.READY,
  extractionStatus: AssignmentFileExtractionStatus.READY,
  extractionError: null,
  extractedText: "extracted content",
  extractedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("AssignmentFileService", () => {
  let service: AssignmentFileService;
  let prisma: any;
  let s3: any;
  let extractor: any;

  beforeEach(async () => {
    prisma = {
      assignmentFile: {
        create: jest.fn().mockResolvedValue(makeDbFile()),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest
        .fn()
        .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    s3 = {
      getBucketName: jest.fn().mockReturnValue("test-bucket"),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentFileService,
        { provide: PrismaService, useValue: prisma },
        { provide: S3Service, useValue: s3 },
        { provide: FileContentExtractionService, useValue: extractor },
      ],
    }).compile();

    service = module.get<AssignmentFileService>(AssignmentFileService);
  });

  describe("uploadAssignmentFiles", () => {
    it("happy path: uploads to S3, extracts, persists with READY status", async () => {
      const result = await service.uploadAssignmentFiles(1, [makeMulterFile()]);

      expect(s3.putObject).toHaveBeenCalledTimes(1);
      expect(extractor.extractContentFromFiles).toHaveBeenCalledTimes(1);
      expect(prisma.assignmentFile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            extractionStatus: AssignmentFileExtractionStatus.READY,
            extractionError: null,
          }),
        }),
      );
      expect(result.files).toHaveLength(1);
      expect(result.files[0].extractionStatus).toBe(
        AssignmentFileExtractionStatus.READY,
      );
    });

    it("marks file FAILED and stores error message when extractor returns error field", async () => {
      extractor.extractContentFromFiles.mockResolvedValue([
        {
          filename: "test.txt",
          content:
            "[ERROR extracting test.txt: parse error]\nFile type: text/plain\n...",
          error: "parse error",
          fileType: "text/plain",
          metadata: { size: 0 },
        },
      ]);
      prisma.assignmentFile.create.mockResolvedValue(
        makeDbFile({
          extractionStatus: AssignmentFileExtractionStatus.FAILED,
          extractionError: "parse error",
          extractedText: null,
          extractedAt: null,
        }),
      );

      const result = await service.uploadAssignmentFiles(1, [makeMulterFile()]);

      expect(prisma.assignmentFile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            extractionStatus: AssignmentFileExtractionStatus.FAILED,
            extractionError: "parse error",
            extractedText: null,
          }),
        }),
      );
      expect(result.files[0].extractionStatus).toBe(
        AssignmentFileExtractionStatus.FAILED,
      );
    });

    it("cleans up uploaded S3 objects and rethrows when DB transaction fails", async () => {
      prisma.$transaction.mockRejectedValue(new Error("DB constraint error"));

      await expect(
        service.uploadAssignmentFiles(1, [makeMulterFile()]),
      ).rejects.toThrow(InternalServerErrorException);

      // One S3 object was uploaded; cleanup must delete it
      expect(s3.deleteObject).toHaveBeenCalledTimes(1);
    });

    it("throws BadRequestException when files array is empty", async () => {
      await expect(service.uploadAssignmentFiles(1, [])).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException when author bucket is not configured", async () => {
      s3.getBucketName.mockReturnValue(undefined);
      await expect(
        service.uploadAssignmentFiles(1, [makeMulterFile()]),
      ).rejects.toThrow(BadRequestException);
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
