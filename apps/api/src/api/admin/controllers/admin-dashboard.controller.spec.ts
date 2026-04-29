import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";

import { AdminGuard } from "../../../auth/guards/admin.guard";
import type { UserSessionRequest } from "../../../auth/interfaces/user.session.interface";
import { RolesGlobalGuard } from "../../../auth/role/roles.global.guard";
import { ScheduledTasksService } from "../../scheduled-tasks/services/scheduled-tasks.service";
import { AdminService } from "../admin.service";
import { AdminDashboardController } from "./admin-dashboard.controller";
import { DashboardStatsQueryDto } from "./dto/dashboard-stats-query.dto";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

const mockAdminService = {
  getDashboardStats: jest.fn().mockResolvedValue({ ok: true }),
  executeQuickAction: jest.fn().mockResolvedValue({}),
  getAssignmentAnalytics: jest.fn().mockResolvedValue({
    data: [],
    pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
  }),
  getDetailedAssignmentInsights: jest.fn().mockResolvedValue({}),
  getGradingStreamsMetric: jest.fn().mockResolvedValue({
    activeLockCount: 7,
    observedAt: "2026-04-29T00:00:00.000Z",
  }),
};

const mockScheduledTasksService = {
  manualCleanupOldDrafts: jest.fn().mockResolvedValue({ deletedCount: 0 }),
};

describe("AdminDashboardController", () => {
  let controller: AdminDashboardController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAdminService.getDashboardStats.mockResolvedValue({ ok: true });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminDashboardController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        {
          provide: ScheduledTasksService,
          useValue: mockScheduledTasksService,
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGlobalGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminDashboardController>(AdminDashboardController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("getDashboardStats userId validation", () => {
    const VALID_EMAIL = "noah.freelove@ibm.com";

    // Use the same global ValidationPipe shape as main.ts:110.
    const validationPipe = new ValidationPipe({ whitelist: true });

    async function validateQuery(
      query: Record<string, unknown>,
    ): Promise<DashboardStatsQueryDto> {
      const result = await validationPipe.transform(query, {
        type: "query",
        metatype: DashboardStatsQueryDto,
      });
      return result as DashboardStatsQueryDto;
    }

    it("rejects garbage userId with 400", async () => {
      await expect(validateQuery({ userId: "not-an-email" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("accepts a normal email userId", async () => {
      const result = await validateQuery({ userId: VALID_EMAIL });
      expect(result).toMatchObject({ userId: VALID_EMAIL });
    });

    it("accepts an absent userId (optional)", async () => {
      const result = await validateQuery({});
      expect(result.userId).toBeUndefined();
    });

    it("rejects email with embedded whitespace", async () => {
      await expect(
        validateQuery({ userId: "noah evil@ibm.com" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("accepts plus-suffix email", async () => {
      const result = await validateQuery({
        userId: "noah.freelove+test@ibm.com",
      });
      expect(result.userId).toBe("noah.freelove+test@ibm.com");
    });

    it("rejects SQL-injection-shaped userId", async () => {
      await expect(validateQuery({ userId: "' OR 1=1 --" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects userId longer than 254 chars (RFC 5321 cap)", async () => {
      const longLocal = "a".repeat(250);
      await expect(
        validateQuery({ userId: `${longLocal}@ibm.com` }),
      ).rejects.toThrow(BadRequestException);
    });

    it("forwards exact-match userId to service when controller is invoked", async () => {
      const valid = await validateQuery({ userId: VALID_EMAIL });
      const fakeRequest = {
        userSession: { userId: "admin-1", role: "ADMIN" },
      } as unknown as UserSessionRequest;

      await controller.getDashboardStats(fakeRequest, valid);

      expect(mockAdminService.getDashboardStats).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: VALID_EMAIL }),
      );
    });
  });

  describe("GET internal/grading-streams (GRADE-03 metric)", () => {
    it("delegates to AdminService.getGradingStreamsMetric with the requester's userId and returns the response unchanged", async () => {
      const fakeRequest = {
        userSession: { userId: "admin@example.com", role: "ADMIN" },
      } as unknown as UserSessionRequest;

      const response = await controller.getGradingStreamsMetric(fakeRequest);

      expect(mockAdminService.getGradingStreamsMetric).toHaveBeenCalledTimes(1);
      expect(mockAdminService.getGradingStreamsMetric).toHaveBeenCalledWith(
        "admin@example.com",
      );
      expect(response).toEqual({
        activeLockCount: 7,
        observedAt: "2026-04-29T00:00:00.000Z",
      });
    });
  });
});
