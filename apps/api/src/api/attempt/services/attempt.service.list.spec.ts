import { ForbiddenException } from "@nestjs/common";
import {
  UserRole,
  UserSession,
} from "../../../auth/interfaces/user.session.interface";
import { AttemptServiceV2 } from "./attempt.service";

const SUMMARY_KEYS = [
  "id",
  "assignmentId",
  "assignmentVersionId",
  "userId",
  "submitted",
  "grade",
  "expiresAt",
  "createdAt",
  "questionOrder",
  "comments",
  "preferredLanguage",
].sort();

describe("AttemptServiceV2.listAssignmentAttempts", () => {
  const row = (id: number, submitted: boolean, grade: number | null) => ({
    id,
    assignmentId: 4,
    assignmentVersionId: 2,
    userId: "learner@example.com",
    submitted,
    grade,
    expiresAt: null,
    createdAt: new Date("2026-10-23T10:00:00.000Z"),
    questionOrder: [1, 2],
    comments: null,
    preferredLanguage: "en",
  });

  const makeService = (showAssignmentScore: boolean) => {
    const prisma = {
      assignment: {
        findUnique: jest.fn().mockResolvedValue({ showAssignmentScore }),
      },
      assignmentAttempt: {
        findMany: jest
          .fn()
          .mockResolvedValue([row(1, true, 0.8), row(2, false, 0.4)]),
      },
    };
    const service = new AttemptServiceV2(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  };

  const learner: UserSession = {
    userId: "learner@example.com",
    role: UserRole.LEARNER,
    groupId: "g",
  };

  it("orders by createdAt then id, selects only summary columns and filters to the learner", async () => {
    const { service, prisma } = makeService(true);

    await service.listAssignmentAttempts(4, learner);

    const [query] = prisma.assignmentAttempt.findMany.mock.calls[0] as [
      {
        where: unknown;
        orderBy: unknown;
        select: Record<string, boolean>;
      },
    ];
    expect(query.where).toEqual({
      assignmentId: 4,
      userId: "learner@example.com",
    });
    expect(query.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(Object.keys(query.select).sort()).toEqual(SUMMARY_KEYS);
  });

  it("returns the grade only for submitted attempts when the score is shown", async () => {
    const { service } = makeService(true);

    const result = await service.listAssignmentAttempts(4, learner);

    expect(result.map((attempt) => attempt.grade)).toEqual([0.8, null]);
    expect(Object.keys(result[0]).sort()).toEqual(SUMMARY_KEYS);
  });

  it("hides every grade when the assignment hides its score", async () => {
    const { service } = makeService(false);

    const result = await service.listAssignmentAttempts(4, learner);

    expect(result.map((attempt) => attempt.grade)).toEqual([null, null]);
  });

  it("refuses a learner session without a userId instead of listing everyone", async () => {
    const { service, prisma } = makeService(true);

    await expect(
      service.listAssignmentAttempts(4, { ...learner, userId: "" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.assignmentAttempt.findMany).not.toHaveBeenCalled();
  });
});
