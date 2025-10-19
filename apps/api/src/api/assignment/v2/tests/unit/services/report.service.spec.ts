/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ReportType } from "@prisma/client";
import { PrismaService } from "src/database/prisma.service";
import {
  createMockAssignment,
  createMockPrismaService,
  createMockReport,
} from "../__mocks__/ common-mocks";
import { ReportService } from "../../../services/report.repository";

describe("ReportService", () => {
  let service: ReportService;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrismaService = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
    prismaService = module.get(PrismaService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createReport", () => {
    const reportParameters = {
      assignmentId: 1,
      issueType: ReportType.BUG,
      description: "Test description",
      userId: "author-123",
    };

    it("should create a report successfully", async () => {
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValueOnce(
        createMockAssignment(),
      );
      (prismaService.report.findMany as jest.Mock).mockResolvedValueOnce([]);

      const createSpy = jest.spyOn(prismaService.report, "create");

      await service.createReport(
        reportParameters.assignmentId,
        reportParameters.issueType,
        reportParameters.description,
        reportParameters.userId,
      );

      expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: reportParameters.assignmentId },
      });

      expect(prismaService.report.findMany).toHaveBeenCalledWith({
        where: {
          reporterId: reportParameters.userId,
          createdAt: {
            gte: expect.any(Date),
          },
        },
      });

      expect(createSpy).toHaveBeenCalledWith({
        data: {
          assignmentId: reportParameters.assignmentId,
          issueType: reportParameters.issueType,
          description: reportParameters.description,
          reporterId: reportParameters.userId,
          author: true,
        },
      });
    });

    it("should throw NotFoundException when assignment does not exist", async () => {
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValueOnce(
        null,
      );

      await expect(
        service.createReport(
          reportParameters.assignmentId,
          reportParameters.issueType,
          reportParameters.description,
          reportParameters.userId,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: reportParameters.assignmentId },
      });
    });

    it("should throw UnprocessableEntityException when rate limit is exceeded", async () => {
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValueOnce(
        createMockAssignment(),
      );

      (prismaService.report.findMany as jest.Mock).mockResolvedValueOnce([
        createMockReport(),
        createMockReport(),
        createMockReport(),
        createMockReport(),
        createMockReport(),
      ]);

      await expect(
        service.createReport(
          reportParameters.assignmentId,
          reportParameters.issueType,
          reportParameters.description,
          reportParameters.userId,
        ),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(prismaService.report.findMany).toHaveBeenCalledWith({
        where: {
          reporterId: reportParameters.userId,
          createdAt: {
            gte: expect.any(Date),
          },
        },
      });
    });
  });

  describe("validateReportInputs", () => {
    it("should throw BadRequestException when issue type is missing", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs(null, "Description", "user-123");
      }).toThrow(BadRequestException);
    });

    it("should throw BadRequestException when description is missing", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs(ReportType.BUG, "", "user-123");
      }).toThrow(BadRequestException);
    });

    it("should throw BadRequestException when issue type is invalid", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs("INVALID_TYPE", "Description", "user-123");
      }).toThrow(BadRequestException);
    });

    it("should throw BadRequestException when user ID is invalid", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs(ReportType.BUG, "Description", "");
      }).toThrow(BadRequestException);
    });

    it("should not throw when all inputs are valid", () => {
      const validateReportInputs = (service as any).validateReportInputs.bind(
        service,
      );

      expect(() => {
        validateReportInputs(ReportType.BUG, "Description", "user-123");
      }).not.toThrow();
    });
  });

  describe("checkRateLimit", () => {
    it("should not throw when user has not reached the rate limit", async () => {
      (prismaService.report.findMany as jest.Mock).mockResolvedValueOnce([
        createMockReport(),
        createMockReport(),
      ]);

      const checkRateLimit = (service as any).checkRateLimit.bind(service);
      await expect(checkRateLimit("user-123")).resolves.not.toThrow();
    });

    it("should throw UnprocessableEntityException when user has reached the rate limit", async () => {
      (prismaService.report.findMany as jest.Mock).mockResolvedValueOnce([
        createMockReport(),
        createMockReport(),
        createMockReport(),
        createMockReport(),
        createMockReport(),
      ]);

      const checkRateLimit = (service as any).checkRateLimit.bind(service);
      await expect(checkRateLimit("user-123")).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });
});
