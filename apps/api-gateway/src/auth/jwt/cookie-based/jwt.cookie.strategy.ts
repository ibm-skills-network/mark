import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";
import {
  UserSession,
  UserSessionPayload,
} from "../../interfaces/user.session.interface";
import { JwtConfigService } from "../jwt.config.service";

interface IRequestWithCookies extends Request {
  cookies: {
    [key: string]: string;
  };
}

interface IJwtPayload extends UserSessionPayload {
  iat: number;
  exp: number;
}

@Injectable()
export class JwtCookieStrategy extends PassportStrategy(
  Strategy,
  "cookie-strategy",
) {
  constructor(private configService: JwtConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: IRequestWithCookies) => {
          return request?.cookies?.authentication;
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
