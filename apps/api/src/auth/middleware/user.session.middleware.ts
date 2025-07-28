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
    try {
      request.userSession = JSON.parse(
        request.headers["user-session"] as string,
      ) as UserSession;
    } catch {
      throw new BadRequestException("Invalid user-session header");
    }
    next();
  }
}
