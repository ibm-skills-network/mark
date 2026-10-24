import {
  BadRequestException,
  Inject,
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from "@nestjs/common";
import { NextFunction, Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  UserSession,
  UserSessionRequest,
} from "../interfaces/user.session.interface";

const STRING_FIELDS = ["userId", "role", "groupId"] as const;

// Guards compare these fields with `===`, so a wrong type is refused here
// rather than silently matching nothing (or everything) downstream.
const describeShapeProblem = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "not_an_object";
  }
  const record = value as Record<string, unknown>;
  for (const field of STRING_FIELDS) {
    const fieldValue = record[field];
    if (
      fieldValue !== undefined &&
      fieldValue !== null &&
      typeof fieldValue !== "string"
    ) {
      return `${field}_not_string`;
    }
  }
  const assignmentId = record.assignmentId;
  if (
    assignmentId !== undefined &&
    assignmentId !== null &&
    (typeof assignmentId !== "number" || !Number.isFinite(assignmentId))
  ) {
    return "assignmentId_not_number";
  }
  return undefined;
};

@Injectable()
export class UserSessionMiddleware implements NestMiddleware {
  private readonly logger: Logger;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: UserSessionMiddleware.name });
  }

  use(request: UserSessionRequest, _: Response, next: NextFunction) {
    const path = request.path || request.originalUrl || "";
    if (path.includes("/reports/renewal-action")) {
      return next();
    }

    const userSessionHeader = request.headers["user-session"] as string;

    if (!userSessionHeader) {
      this.logger.error("user-session header missing", {
        path,
        method: request.method,
        request_id:
          request.get("akamai-grn") ?? request.get("x-request-id") ?? undefined,
      });
      throw new UnauthorizedException("Missing or invalid user session");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(userSessionHeader);
    } catch (parseError) {
      this.logger.error("user-session header parse failed", {
        path,
        method: request.method,
        request_id:
          request.get("akamai-grn") ?? request.get("x-request-id") ?? undefined,
        error:
          parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw new BadRequestException("Invalid user-session header");
    }

    const shapeProblem = describeShapeProblem(parsed);
    if (shapeProblem !== undefined) {
      this.logger.error("user-session header has the wrong shape", {
        path,
        method: request.method,
        request_id:
          request.get("akamai-grn") ?? request.get("x-request-id") ?? undefined,
        reason: shapeProblem,
      });
      throw new BadRequestException("Invalid user-session header");
    }
    request.userSession = parsed as UserSession;
    next();
  }
}
