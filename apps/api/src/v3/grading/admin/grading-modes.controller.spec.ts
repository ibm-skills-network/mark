import { BadRequestException } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import type { UserSessionRequest } from "../../../auth/interfaces/user.session.interface";
import type { PrismaService } from "../../../database/prisma.service";
import type { GradingModeService } from "../mode";
import { GradingModesController } from "./grading-modes.controller";

describe("GradingModesController", () => {
  const log = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const table = {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  };
  const prisma = {
    gradingModeConfig: table,
    assignment: { findUnique: jest.fn() },
    $transaction: jest.fn((run: (tx: unknown) => unknown) =>
      run({ gradingModeConfig: table }),
    ),
  };
  const modes = { invalidate: jest.fn() };
  const request = {
    userSession: { userId: "admin@example.com" },
  } as unknown as UserSessionRequest;
  let controller: GradingModesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new GradingModesController(
      prisma as unknown as PrismaService,
      modes as unknown as GradingModeService,
      { child: () => log } as never,
    );
  });

  it.each([
    [{}],
    [
      {
        questionType: "TRUE_FALSE",
        assignmentId: null,
        mode: "live",
        effort: null,
      },
    ],
    [{ questionType: "TEXT", assignmentId: -1, mode: "live", effort: null }],
    [{ questionType: "TEXT", assignmentId: 1.5, mode: "live", effort: null }],
    [{ questionType: "TEXT", assignmentId: null, mode: "on", effort: null }],
    [{ questionType: "TEXT", assignmentId: null, mode: "live", effort: "max" }],
    [
      {
        questionType: "TEXT",
        assignmentId: null,
        mode: "live",
        effort: null,
        isAdmin: true,
      },
    ],
  ])("rejects %p with a generic 400", async (body) => {
    await expect(controller.put(request, body)).rejects.toThrow(
      new BadRequestException("Invalid request"),
    );
    expect(table.create).not.toHaveBeenCalled();
    expect(table.update).not.toHaveBeenCalled();
  });

  it("rejects an assignment that does not exist", async () => {
    prisma.assignment.findUnique.mockResolvedValue(null);
    await expect(
      controller.put(request, {
        questionType: "TEXT",
        assignmentId: 99,
        mode: "live",
        effort: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(table.create).not.toHaveBeenCalled();
  });

  it("updates an existing row, logs before and after, and drops the cache", async () => {
    const before = {
      id: 4,
      questionType: QuestionType.TEXT,
      assignmentId: null,
      mode: "off",
      effort: null,
    };
    const after = { ...before, mode: "live", effort: "medium" };
    table.findFirst.mockResolvedValue(before);
    table.update.mockResolvedValue(after);
    await expect(
      controller.put(request, {
        questionType: "TEXT",
        assignmentId: null,
        mode: "live",
        effort: "medium",
      }),
    ).resolves.toBe(after);
    expect(table.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 4 },
        data: {
          mode: "live",
          effort: "medium",
          updatedBy: "admin@example.com",
        },
      }),
    );
    expect(modes.invalidate).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      "grading.modes.updated",
      expect.objectContaining({
        admin: "admin@example.com",
        before: { id: 4, mode: "off", effort: null },
        after: { id: 4, mode: "live", effort: "medium" },
      }),
    );
  });

  it("creates an assignment row when none exists", async () => {
    prisma.assignment.findUnique.mockResolvedValue({ id: 7 });
    table.findFirst.mockResolvedValue(null);
    table.create.mockResolvedValue({ id: 5 });
    await controller.put(request, {
      questionType: "UPLOAD",
      assignmentId: 7,
      mode: "shadow",
      effort: null,
    });
    expect(table.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          questionType: "UPLOAD",
          assignmentId: 7,
          mode: "shadow",
          effort: null,
          updatedBy: "admin@example.com",
        },
      }),
    );
  });
});
