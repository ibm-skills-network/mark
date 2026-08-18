import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";

import { AdminGuard } from "../../../auth/guards/admin.guard";
import type { UserSessionRequest } from "../../../auth/interfaces/user.session.interface";
import {
  ROLES_KEY,
  RolesGlobalGuard,
} from "../../../auth/role/roles.global.guard";
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

  describe("getDashboardStats assignmentId validation", () => {
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

    it("accepts a positive integer string", async () => {
      const result = await validateQuery({ assignmentId: "42" });
      expect(result.assignmentId).toBe("42");
    });

    it("rejects mixed alphanumeric like '1abc'", async () => {
      await expect(validateQuery({ assignmentId: "1abc" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects non-numeric strings", async () => {
      await expect(validateQuery({ assignmentId: "abc" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects zero", async () => {
      await expect(validateQuery({ assignmentId: "0" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects negative integers", async () => {
      await expect(validateQuery({ assignmentId: "-1" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects leading-zero values like '01'", async () => {
      await expect(validateQuery({ assignmentId: "01" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects decimal values", async () => {
      await expect(validateQuery({ assignmentId: "1.5" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("accepts an absent assignmentId (optional)", async () => {
      const result = await validateQuery({});
      expect(result.assignmentId).toBeUndefined();
    });

    it("controller converts validated assignmentId to a Number before calling service", async () => {
      const valid = await validateQuery({ assignmentId: "7" });
      const fakeRequest = {
        userSession: { userId: "admin-1", role: "ADMIN" },
      } as unknown as UserSessionRequest;

      await controller.getDashboardStats(fakeRequest, valid);

      expect(mockAdminService.getDashboardStats).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ assignmentId: 7 }),
      );
    });
  });

  describe("getAssignmentAnalytics validation & forwarding", () => {
    const fakeRequest = {
      userSession: { userId: "admin-1", role: "ADMIN" },
    } as unknown as UserSessionRequest;

    it("forwards every validated param to the service in order", async () => {
      await controller.getAssignmentAnalytics(
        fakeRequest,
        2, // page
        25, // limit
        "essay", // search
        true, // details
        "name", // sortBy
        "asc", // sortOrder
        true, // published
      );

      expect(mockAdminService.getAssignmentAnalytics).toHaveBeenCalledWith(
        fakeRequest.userSession,
        2,
        25,
        "essay",
        true,
        "name",
        "asc",
        true,
      );
    });

    it("passes undefined sortBy/sortOrder/published through (service applies defaults)", async () => {
      await controller.getAssignmentAnalytics(fakeRequest, 1, 10);

      expect(mockAdminService.getAssignmentAnalytics).toHaveBeenCalledWith(
        fakeRequest.userSession,
        1,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it("accepts every allow-listed sortBy field", async () => {
      for (const field of ["name", "updatedAt", "published"]) {
        await expect(
          controller.getAssignmentAnalytics(
            fakeRequest,
            1,
            10,
            undefined,
            false,
            field,
          ),
        ).resolves.toBeDefined();
      }
    });

    it("rejects an unknown sortBy with 400 and the allow-list message", async () => {
      await expect(
        controller.getAssignmentAnalytics(
          fakeRequest,
          1,
          10,
          undefined,
          false,
          "garbage",
        ),
      ).rejects.toThrow(
        new BadRequestException(
          "sortBy must be one of: name, updatedAt, published",
        ),
      );
      expect(mockAdminService.getAssignmentAnalytics).not.toHaveBeenCalled();
    });

    it("rejects an unknown sortOrder with 400", async () => {
      await expect(
        controller.getAssignmentAnalytics(
          fakeRequest,
          1,
          10,
          undefined,
          false,
          "name",
          "sideways",
        ),
      ).rejects.toThrow(
        new BadRequestException('sortOrder must be "asc" or "desc"'),
      );
      expect(mockAdminService.getAssignmentAnalytics).not.toHaveBeenCalled();
    });

    it("rejects a limit above the MAX_LIMIT cap with 400", async () => {
      await expect(
        controller.getAssignmentAnalytics(fakeRequest, 1, 26),
      ).rejects.toThrow(new BadRequestException("Limit cannot exceed 25"));
      expect(mockAdminService.getAssignmentAnalytics).not.toHaveBeenCalled();
    });

    it("rejects a non-positive limit with 400 (no negative/zero Prisma take)", async () => {
      await expect(
        controller.getAssignmentAnalytics(fakeRequest, 1, 0),
      ).rejects.toThrow(new BadRequestException("Limit must be at least 1"));
      await expect(
        controller.getAssignmentAnalytics(fakeRequest, 1, -1),
      ).rejects.toThrow(new BadRequestException("Limit must be at least 1"));
      expect(mockAdminService.getAssignmentAnalytics).not.toHaveBeenCalled();
    });

    it("rejects a non-positive page with 400 (no negative Prisma skip)", async () => {
      await expect(
        controller.getAssignmentAnalytics(fakeRequest, 0, 25),
      ).rejects.toThrow(new BadRequestException("Page must be at least 1"));
      await expect(
        controller.getAssignmentAnalytics(fakeRequest, -5, 25),
      ).rejects.toThrow(new BadRequestException("Page must be at least 1"));
      expect(mockAdminService.getAssignmentAnalytics).not.toHaveBeenCalled();
    });
  });
  describe("guard metadata", () => {
    // Regression: RolesGlobalGuard is registered globally, so Nest runs it
    // before this controller's AdminGuard. Any @Roles metadata here is decided
    // against the forwarded cookie session, which for an admin browsing with a
    // learner launch cookie is role "learner" -> 403 before AdminGuard can
    // establish the admin role. AdminGuard alone is both correct and narrower.
    const handlerNames = [
      "getDashboardStats",
      "executeQuickAction",
      "getAssignmentAnalytics",
      "getDetailedAssignmentInsights",
      "manualDraftCleanup",
    ] as const;

    it("declares AdminGuard at the controller level", () => {
      const guards: unknown[] =
        Reflect.getMetadata("__guards__", AdminDashboardController) ?? [];
      expect(guards).toContain(AdminGuard);
    });

    it.each(handlerNames)(
      "does not put @Roles metadata on %s",
      (handlerName) => {
        const handler = (
          AdminDashboardController.prototype as unknown as Record<
            string,
            (...args: unknown[]) => unknown
          >
        )[handlerName];

        expect(handler).toBeDefined();
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      },
    );
  });
});
