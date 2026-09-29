import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Request } from "express";
import { verify } from "jsonwebtoken";
import { ExtractJwt, Strategy } from "passport-jwt";
import {
  UserSession,
  UserSessionPayload,
} from "../../interfaces/user.session.interface";
import { JwtConfigService } from "../jwt.config.service";
import {
  AUTHOR_COOKIE_PREFIX,
  quizSessionContext,
  LEARNER_COOKIE_PREFIX,
  selectAuthenticationCookie,
  unverifiedSession,
} from "./jwt.cookie.extractor";

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
      passReqToCallback: true,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validate(request: IRequestWithCookies, payload: IJwtPayload): UserSession {
    const context = quizSessionContext(request.headers ?? {});
    const routeId = request.originalUrl?.match(
      /\/assignments\/([1-9]\d*)(?:[/?]|$)/,
    )?.[1];
    if (
      (payload.role === "author" &&
        routeId &&
        Number(routeId) !== payload.assignmentID) ||
      (context !== undefined &&
        (payload.role !== context.role ||
          payload.assignmentID !== context.assignmentId ||
          (routeId && Number(routeId) !== context.assignmentId)))
    ) {
      logger.warn("Quiz session does not match requested role or assignment");
      throw new UnauthorizedException(
        "Relaunch this quiz in the requested role",
      );
    }
    const editorUser = request.headers?.["x-mark-author-user"];
    if (
      context !== undefined &&
      editorUser !== undefined &&
      editorUser !== payload.userID
    ) {
      logger.warn("Author session account changed");
      throw new UnauthorizedException(
        "Return to the account that opened this editor",
      );
    }
    // A scoped cookie must not revive an expired, tampered, or signed-out
    // browser session. Passport verifies the selected token; verify the
    // current launch separately before using it as the account-switch boundary.
    const selected = selectAuthenticationCookie(request).token;
    const current = selectAuthenticationCookie({
      headers: { cookie: request.headers?.cookie },
      cookies: request.cookies,
    }).token;
    if (selected && selected !== current) {
      try {
        if (!current) throw new Error("Missing current session");
        const claims = verify(current, this.configService.jwtConstants.secret);
        if (typeof claims === "string" || claims.userID !== payload.userID)
          throw new Error("Account changed");
      } catch {
        logger.warn("Quiz session recovery requires a valid current session");
        throw new UnauthorizedException(
          "Relaunch this quiz in the requested role",
        );
      }
    }
    // Only persist tokens after passport has verified their signature and expiry.
    // A bounded set per role keeps author and learner launches independent.
    if (
      (payload.role === "author" || payload.role === "learner") &&
      Number.isSafeInteger(payload.assignmentID) &&
      payload.assignmentID > 0 &&
      request.res
    ) {
      const { token } = selectAuthenticationCookie(request);
      const prefix =
        payload.role === "author"
          ? AUTHOR_COOKIE_PREFIX
          : LEARNER_COOKIE_PREFIX;
      const name = `${prefix}${payload.assignmentID}`;
      if (token && request.cookies?.[name] !== token) {
        const secure = process.env.NODE_ENV === "production";
        const options = {
          httpOnly: true,
          secure,
          sameSite: "lax" as const,
          path: "/",
        };
        const others = Object.entries(request.cookies ?? {})
          .filter(([key]) => key.startsWith(prefix) && key !== name)
          .sort(
            (a, b) =>
              (unverifiedSession(b[1]).iat ?? 0) -
              (unverifiedSession(a[1]).iat ?? 0),
          );
        for (const [key] of others.slice(3))
          request.res.clearCookie(key, options);
        request.res.cookie(name, token, {
          ...options,
          maxAge: Math.max(
            0,
            Math.min(payload.exp * 1000 - Date.now(), 6 * 60 * 60 * 1000),
          ),
        });
      }
    }
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
