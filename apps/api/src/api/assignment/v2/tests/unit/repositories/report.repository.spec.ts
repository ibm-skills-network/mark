/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/unbound-method */

import {
  BadRequestException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ReportType } from "@prisma/client";
import { PrismaService } from "src/prisma.service";
import {
  createMockAssignment,
  createMockReport,
} from "../__mocks__/ common-mocks";
import { ReportService } from "../../../services/report.repository";

describe("ReportService", () => {
  let service: ReportService;
  let prismaService: PrismaService;

  const mockReport = createMockReport();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: PrismaService,
          useValue: {
            assignment: {
              findUnique: jest.fn(),
            },
            report: {
              create: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createReport", () => {
    it("should create a report successfully", async () => {
      const assignmentId = 1;
      const issueType = ReportType.BUG;
      const description = "Test report description";
      const userId = "user123";

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(createMockAssignment());
      jest.spyOn(prismaService.report, "findMany").mockResolvedValue([]);
      jest.spyOn(prismaService.report, "create").mockResolvedValue(mockReport);

      await service.createReport(assignmentId, issueType, description, userId);

      expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: assignmentId },
      });
      expect(prismaService.report.create).toHaveBeenCalledWith({
        data: {
          assignmentId,
          issueType,
          description,
          reporterId: userId,
          author: true,
        },
      });
    });

    it("should throw NotFoundException if assignment does not exist", async () => {
      const assignmentId = 999;
      const issueType = ReportType.BUG;
      const description = "Test report description";
      const userId = "user123";

      jest
        .spyOn(prismaService.assignment, "findUnique")
        .mockResolvedValue(null);

      await expect(
        service.createReport(assignmentId, issueType, description, userId),
      ).rejects.toThrow(NotFoundException);
      expect(prismaService.report.create).not.toHaveBeenCalled();
    });

    it("should throw BadRequestException if issue type is missing", async () => {
      const assignmentId = 1;
      const issueType = undefined as unknown as ReportType;
      const description = "Test report description";
      const userId = "user123";

      await expect(
        service.createReport(assignmentId, issueType, description, userId),
      ).rejects.toThrow(BadRequestException);
      expect(prismaService.assignment.findUnique).not.toHaveBeenCalled();
      expect(prismaService.report.create).not.toHaveBeenCalled();
    });

    it("should throw BadRequestException if description is missing", async () => {
      const assignmentId = 1;
      const issueType = ReportType.BUG;
      const description = "";
      const userId = "user123";

      await expect(
        service.createReport(assignmentId, issueType, description, userId),
      ).rejects.toThrow(BadRequestException);
      expect(prismaService.assignment.findUnique).not.toHaveBeenCalled();
      expect(prismaService.report.create).not.toHaveBeenCalled();
    });

    it("should throw BadRequestException if userId is invalid", async () => {
      const assignmentId = 1;
      const issueType = ReportType.BUG;
      const description = "Test report description";
      const userId = "";

      await expect(
        service.createReport(assignmentId, issueType, description, userId),
      ).rejects.toThrow(BadRequestException);
      expect(prismaService.assignment.findUnique).not.toHaveBeenCalled();
      expect(prismaService.report.create).not.toHaveBeenCalled();
    });

    it("should throw UnprocessableEntityException if rate limit is exceeded", async () => {
      const assignmentId = 1;
      const issueType = ReportType.BUG;
      const description = "Test report description";
      const userId = "user123";

      const recentReports = Array.from({ length: 5 }).fill(
        createMockReport({
          assignmentId,
          issueType,
          description,
          reporterId: userId,
        }),
      );

      jest.spyOn(prismaService.assignment, "findUnique").mockResolvedValue({
        id: assignmentId,
        name: "Test Assignment",
      } as any);
      jest
        .spyOn(prismaService.report, "findMany")
        .mockResolvedValue(recentReports);

      await expect(
        service.createReport(assignmentId, issueType, description, userId),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prismaService.report.create).not.toHaveBeenCalled();
    });
  });

  describe("validateReportInputs", () => {
    it("should not throw an error for valid inputs", () => {
      const issueType = ReportType.BUG;
      const description = "Test report description";
      const userId = "user123";

      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() =>
        validateReportInputs(issueType, description, userId),
      ).not.toThrow();
    });

    it("should throw BadRequestException for missing issue type", () => {
      const issueType = undefined as unknown as ReportType;
      const description = "Test report description";
      const userId = "user123";

      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() =>
        validateReportInputs(issueType, description, userId),
      ).toThrow(BadRequestException);
    });

    it("should throw BadRequestException for invalid issue type", () => {
      const issueType = "INVALID_TYPE" as unknown as ReportType;
      const description = "Test report description";
      const userId = "user123";

      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() =>
        validateReportInputs(issueType, description, userId),
      ).toThrow(BadRequestException);
    });

    it("should throw BadRequestException for missing description", () => {
      const issueType = ReportType.BUG;
      const description = "";
      const userId = "user123";

      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() =>
        validateReportInputs(issueType, description, userId),
      ).toThrow(BadRequestException);
    });

    it("should throw BadRequestException for invalid userId", () => {
      const issueType = ReportType.BUG;
      const description = "Test report description";
      const userId = "";

      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() =>
        validateReportInputs(issueType, description, userId),
      ).toThrow(BadRequestException);
    });
  });

  describe("checkRateLimit", () => {
    it("should not throw an error if user is under rate limit", async () => {
      const userId = "user123";

      const recentReports = Array.from({ length: 4 }).fill({
        id: 1,
        assignmentId: 1,
        issueType: ReportType.BUG,
        description: "Test report",
        reporterId: userId,
        createdAt: new Date(),
      });

      jest
        .spyOn(prismaService.report, "findMany")
        .mockResolvedValue(recentReports);

      const checkRateLimit = (service as any).checkRateLimit.bind(service);

      await expect(checkRateLimit(userId)).resolves.not.toThrow();
      expect(prismaService.report.findMany).toHaveBeenCalledWith({
        where: {
          reporterId: userId,
          createdAt: {
            gte: expect.any(Date),
          },
        },
      });
    });

    it("should throw UnprocessableEntityException if user exceeds rate limit", async () => {
      const userId = "user123";

      const recentReports = Array.from({ length: 5 }).fill({
        id: 1,
        assignmentId: 1,
        issueType: ReportType.BUG,
        description: "Test report",
        reporterId: userId,
        createdAt: new Date(),
      });

      jest
        .spyOn(prismaService.report, "findMany")
        .mockResolvedValue(recentReports);

      const checkRateLimit = (service as any).checkRateLimit.bind(service);

      await expect(checkRateLimit(userId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prismaService.report.findMany).toHaveBeenCalled();
    });
  });
});
