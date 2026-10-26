import { BadRequestError, UnauthorizedError } from "../../shared/errors.js";

export type Role = "learner" | "author" | "admin";

export type Principal = {
  userId: string;
  role: Role;
  groupId: string | null;
  assignmentId: number | null;
  gradingCallbackRequired: boolean;
  // The parsed header as received, for fields read later (returnUrl, courseId).
  // Never log it.
  raw: Record<string, unknown>;
};

export type RejectionReason =
  | "missing"
  | "invalid_json"
  | "not_an_object"
  | "userId_not_string"
  | "role_not_string"
  | "groupId_not_string"
  | "assignmentId_not_number"
  | "gradingCallbackRequired_not_boolean"
  | "role_unknown"
  | "userId_empty";

const ROLES: readonly Role[] = ["learner", "author", "admin"];

function isRole(value: string): value is Role {
  return ROLES.some((r) => r === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuse(reason: RejectionReason): BadRequestError {
  return new BadRequestError("Invalid user session", { reason });
}

export function rejectionReason(err: unknown): RejectionReason | undefined {
  if (
    (err instanceof BadRequestError || err instanceof UnauthorizedError) &&
    typeof err.details?.reason === "string"
  ) {
    // Only parseUserSession sets details.reason, always from RejectionReason.
    return err.details.reason as RejectionReason;
  }
  return undefined;
}

export function parseUserSession(header: string | undefined): Principal {
  if (header === undefined || header.trim() === "") {
    throw new UnauthorizedError("Unauthorized", { reason: "missing" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    // The refusal below carries the reason; the header content is never logged.
    throw refuse("invalid_json");
  }
  if (!isRecord(parsed)) throw refuse("not_an_object");

  const { userId, role, groupId, assignmentId, gradingCallbackRequired } =
    parsed;
  if (typeof userId !== "string") throw refuse("userId_not_string");
  if (typeof role !== "string") throw refuse("role_not_string");
  if (groupId !== undefined && groupId !== null && typeof groupId !== "string")
    throw refuse("groupId_not_string");
  if (
    assignmentId !== undefined &&
    assignmentId !== null &&
    !(typeof assignmentId === "number" && Number.isFinite(assignmentId))
  )
    throw refuse("assignmentId_not_number");
  if (
    gradingCallbackRequired !== undefined &&
    typeof gradingCallbackRequired !== "boolean"
  )
    throw refuse("gradingCallbackRequired_not_boolean");
  if (!isRole(role)) throw refuse("role_unknown");
  if (userId === "") throw refuse("userId_empty");

  return {
    userId,
    role,
    groupId: typeof groupId === "string" ? groupId : null,
    assignmentId: typeof assignmentId === "number" ? assignmentId : null,
    gradingCallbackRequired: gradingCallbackRequired ?? false,
    raw: parsed,
  };
}
