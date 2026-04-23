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

    try {
      request.userSession = JSON.parse(userSessionHeader) as UserSession;
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
    next();
  }
}
