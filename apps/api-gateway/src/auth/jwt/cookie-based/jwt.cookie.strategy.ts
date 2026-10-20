import { randomUUID } from "node:crypto";
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
} from "./jwt.cookie.extractor";
import {
  isStoreId,
  SAVED_SESSION_COOKIE,
  SavedSessionStore,
} from "./saved-session.store";

interface IRequestWithCookies extends Request {
  cookies: {
    [key: string]: string;
  };
  savedSession?: string;
}

interface IJwtPayload extends UserSessionPayload {
  iat: number;
  exp: number;
}

// Routed through winston: main.ts passes the winston logger to NestFactory.
const logger = new Logger("JwtCookieStrategy");

const SAVED_SESSION_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// Matches only the names the old per-quiz cookies used, so clearing never throws.
const LEGACY_SESSION_COOKIE = new RegExp(
  `^(?:${AUTHOR_COOKIE_PREFIX}|${LEARNER_COOKIE_PREFIX})\\d+$`,
);

// LMS-supplied labels for support tickets. Control characters are stripped
// so each stays one line wherever it is shown; SN Support caps these at 500.
function singleLineText(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const text = value.replaceAll(/[\u0000-\u001F\u007F]+/g, " ").trim();
  return text && text.length <= maxLength ? text : undefined;
}

@Injectable()
export class JwtCookieStrategy extends PassportStrategy(
  Strategy,
  "cookie-strategy",
) {
  constructor(
    private configService: JwtConfigService,
    private savedSessions: SavedSessionStore,
  ) {
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
    // A saved session must not revive an expired, tampered, or signed-out
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
    if (request.res) {
      const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
      };
      for (const key of Object.keys(request.cookies ?? {})) {
        if (LEGACY_SESSION_COOKIE.test(key))
          request.res.clearCookie(key, options);
      }
      // validate() has already matched the payload to this quiz context.
      if (
        context !== undefined &&
        selected &&
        selected !== request.savedSession
      ) {
        const existing = request.cookies?.[SAVED_SESSION_COOKIE];
        const stored = isStoreId(existing);
        const storeId = stored ? existing : randomUUID();
        request.res.cookie(SAVED_SESSION_COOKIE, storeId, {
          ...options,
          maxAge: SAVED_SESSION_MAX_AGE_MS,
        });
        // Only save once the browser has kept the store cookie.
        if (stored)
          void this.savedSessions.save(
            storeId,
            context.role,
            context.assignmentId,
            selected,
          );
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
      // Printable ASCII only: the session is forwarded as a raw header.
      lisOutcomeServiceUrl: [
        payload.grading?.lis_outcome_service_url,
        payload.lis_outcome_service_url,
      ].find(
        (value): value is string =>
          typeof value === "string" && /^[!-~]+$/.test(value),
      ),
      toolConsumerInstanceGuid:
        typeof payload.toolConsumerInstanceGuid === "string" &&
        /^[!-~]{1,255}$/.test(payload.toolConsumerInstanceGuid)
          ? payload.toolConsumerInstanceGuid
          : undefined,
      courseTitle: singleLineText(payload.courseTitle),
      courseId: singleLineText(payload.courseId),
      activityTitle: singleLineText(payload.activityTitle),
      toolConsumerProductFamilyCode: singleLineText(
        payload.toolConsumerProductFamilyCode,
        255,
      ),
    };
  }
}
