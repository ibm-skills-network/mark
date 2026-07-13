import { Injectable, Logger } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";
import {
  UserSession,
  UserSessionPayload,
} from "../../interfaces/user.session.interface";
import { JwtConfigService } from "../jwt.config.service";
import { selectAuthenticationCookie } from "./jwt.cookie.extractor";

interface IRequestWithCookies extends Request {
  cookies: {
    [key: string]: string;
  };
}

interface IJwtPayload extends UserSessionPayload {
  iat: number;
  exp: number;
}

// Routed through winston: main.ts passes the winston logger to NestFactory.
const logger = new Logger("JwtCookieStrategy");

@Injectable()
export class JwtCookieStrategy extends PassportStrategy(
  Strategy,
  "cookie-strategy",
) {
  constructor(private configService: JwtConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: IRequestWithCookies) => {
          const { token, candidateCount } = selectAuthenticationCookie(request);
          if (candidateCount > 1) {
            // Duplicate cookie jars (Lax vs Partitioned attributes coexist).
            // We authenticate the newest launch; log so the fleet-wide rate
            // of duplicates stays observable. Never log token contents.
            logger.warn(
              `Multiple authentication cookies on request (count=${candidateCount}, path=${request.path}); using newest iat`,
            );
          }
          // passport-jwt's JwtFromRequestFunction contract uses null for "no token".
          // eslint-disable-next-line unicorn/no-null
          return token ?? null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.jwtConstants.secret,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validate(payload: IJwtPayload): UserSession {
    return {
      userId: payload.userID,
      role: payload.role,
      groupId: payload.groupID,
      assignmentId: payload.assignmentID,
      gradingCallbackRequired: payload.gradingCallbackRequired,
      returnUrl: payload.returnUrl,
      launch_presentation_locale: payload.launch_presentation_locale,
    };
  }
}
