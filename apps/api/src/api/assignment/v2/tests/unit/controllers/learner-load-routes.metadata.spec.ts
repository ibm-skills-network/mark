import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AssignmentAccessControlGuard } from "src/api/assignment/guards/assignment.access.control.guard";
import { AttemptControllerV2 } from "src/api/attempt/attempt.controller";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { ROLES_KEY } from "src/auth/role/roles.global.guard";
import { TRANSFORM_METADATA_KEY } from "src/common/interceptors/data-transform.interceptor";
import { AssignmentControllerV2 } from "../../../controllers/assignment.controller";

type Handler = (...arguments_: unknown[]) => unknown;

const handlerOf = (prototype: object, name: string): Handler =>
  (prototype as Record<string, Handler>)[name];

describe("learner load routes", () => {
  const plainJsonRoutes: Array<[string, object, string]> = [
    ["GET assignment", AssignmentControllerV2.prototype, "getAssignment"],
    [
      "GET languages",
      AssignmentControllerV2.prototype,
      "getAvailableLanguages",
    ],
    ["GET attempts", AttemptControllerV2.prototype, "listAssignmentAttempts"],
    ["POST attempts", AttemptControllerV2.prototype, "createAssignmentAttempt"],
    ["GET attempt", AttemptControllerV2.prototype, "getAssignmentAttempt"],
    ["POST abandon", AttemptControllerV2.prototype, "abandonAssignmentAttempt"],
    [
      "GET completed attempt",
      AttemptControllerV2.prototype,
      "getLearnerAssignmentAttempt",
    ],
  ];

  it.each(plainJsonRoutes)(
    "%s responds without base64 encoding",
    (_label, prototype, name) => {
      expect(
        Reflect.getMetadata(TRANSFORM_METADATA_KEY, handlerOf(prototype, name)),
      ).toEqual({ encodeResponse: false });
    },
  );

  it("leaves other routes on the default transform", () => {
    expect(
      Reflect.getMetadata(
        TRANSFORM_METADATA_KEY,
        handlerOf(AttemptControllerV2.prototype, "submitFeedback"),
      ),
    ).toBeUndefined();
  });

  it("guards the languages route with assignment access for learners and authors", () => {
    const handler = handlerOf(
      AssignmentControllerV2.prototype,
      "getAvailableLanguages",
    );
    const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
      []) as unknown[];

    expect(guards).toContain(AssignmentAccessControlGuard);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      UserRole.LEARNER,
      UserRole.AUTHOR,
    ]);
  });

  it("uses the first value of a repeated lang on the assignment read", async () => {
    const getAssignment = jest.fn().mockResolvedValue({});
    const session = { userId: "learner@example.com", role: UserRole.LEARNER };

    await AssignmentControllerV2.prototype.getAssignment.call(
      { assignmentService: { getAssignment } },
      5,
      { userSession: session } as never,
      ["fr", "de"],
    );

    expect(getAssignment).toHaveBeenCalledWith(5, session, "fr");
  });

  it("uses the first value of a repeated lang on the attempt read", async () => {
    const getAssignmentAttempt = jest.fn().mockResolvedValue({});
    const session = { userId: "learner@example.com", role: UserRole.LEARNER };

    await AttemptControllerV2.prototype.getAssignmentAttempt.call(
      { attemptService: { getAssignmentAttempt } },
      "9",
      { userSession: session } as never,
      ["zh-cn", "en"],
    );

    expect(getAssignmentAttempt).toHaveBeenCalledWith(9, session, "zh-cn");
  });
});
