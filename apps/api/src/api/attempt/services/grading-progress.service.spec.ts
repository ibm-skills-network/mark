import { Test, TestingModule } from "@nestjs/testing";
import { GradingStatus } from "@prisma/client";
import { AdminEmailService } from "../../../auth/services/admin-email.service";
import { PrismaService } from "../../../database/prisma.service";
import { GradingProgressService } from "./grading-progress.service";

describe("GradingProgressService.markComplete", () => {
  let service: GradingProgressService;

  const mockPrisma = {
    gradingProgress: {
      update: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const mockEmailService = {
    sendGradingCompletionEmail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingProgressService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AdminEmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<GradingProgressService>(GradingProgressService);
    jest.clearAllMocks();
    mockPrisma.gradingProgress.update.mockResolvedValue({});
  });

  it("writes COMPLETED before reading the attempt for the notification", async () => {
    const callOrder: string[] = [];

    mockPrisma.gradingProgress.update.mockImplementation(async () => {
      callOrder.push("update");
      return {};
    });
    mockPrisma.gradingProgress.findUnique.mockImplementation(async () => {
      callOrder.push("read");
      return {
        attemptId: 77,
        notifyOnComplete: false,
        notificationEmail: null,
        attempt: { assignmentId: 12, grade: 0.75, submitted: true },
      };
    });

    await service.markComplete(77);

    expect(callOrder).toEqual(["update", "read"]);
    expect(mockPrisma.gradingProgress.update).toHaveBeenCalledWith({
      where: { attemptId: 77 },
      data: expect.objectContaining({
        status: GradingStatus.COMPLETED,
        progress: 100,
      }),
    });
  });

  it("emails the committed grade rather than a missing one", async () => {
    mockPrisma.gradingProgress.findUnique.mockResolvedValue({
      attemptId: 77,
      notifyOnComplete: true,
      notificationEmail: "learner@example.com",
      attempt: { assignmentId: 12, grade: 0.75, submitted: true },
    });

    await service.markComplete(77);

    expect(mockEmailService.sendGradingCompletionEmail).toHaveBeenCalledWith(
      "learner@example.com",
      12,
      77,
      75,
    );
  });

  it("emails a genuine 0% grade rather than treating it as missing", async () => {
    mockPrisma.gradingProgress.findUnique.mockResolvedValue({
      attemptId: 77,
      notifyOnComplete: true,
      notificationEmail: "learner@example.com",
      attempt: { assignmentId: 12, grade: 0, submitted: true },
    });

    await service.markComplete(77);

    expect(mockEmailService.sendGradingCompletionEmail).toHaveBeenCalledWith(
      "learner@example.com",
      12,
      77,
      0,
    );
  });

  it("warns when it is reached before the attempt has been committed", async () => {
    const warn = jest
      .spyOn(
        Reflect.get(service, "logger") as {
          warn: (message: string) => void;
        },
        "warn",
      )
      .mockImplementation(() => undefined);

    mockPrisma.gradingProgress.findUnique.mockResolvedValue({
      attemptId: 77,
      notifyOnComplete: false,
      notificationEmail: null,
      attempt: { assignmentId: 12, grade: null, submitted: false },
    });

    await service.markComplete(77);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("grading.progress.completed.before.commit"),
    );
  });

  it("does not touch the database for author preview attempts", async () => {
    await service.markComplete(-1);

    expect(mockPrisma.gradingProgress.update).not.toHaveBeenCalled();
    expect(mockPrisma.gradingProgress.findUnique).not.toHaveBeenCalled();
  });
});
