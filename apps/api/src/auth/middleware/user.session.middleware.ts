import {
  BadRequestException,
  Injectable,
  NestMiddleware,
} from "@nestjs/common";
import { NextFunction, Response } from "express";
import {
  UserSession,
  UserSessionRequest,
} from "../interfaces/user.session.interface";

@Injectable()
export class UserSessionMiddleware implements NestMiddleware {
  use(request: UserSessionRequest, _: Response, next: NextFunction) {
    const userSessionHeader = request.headers["user-session"] as string;

    if (!userSessionHeader) {
      console.error("Invalid user-session header format");
      throw new BadRequestException("Invalid user-session header");
    }

    try {
      request.userSession = JSON.parse(userSessionHeader) as UserSession;
    } catch {
      console.error("Invalid user-session header format");
      throw new BadRequestException("Invalid user-session header");
    }
    next();
  }
}
