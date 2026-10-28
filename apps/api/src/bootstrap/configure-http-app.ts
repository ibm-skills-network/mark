import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import cookieParser from "cookie-parser";
import {
  json,
  urlencoded,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import helmet from "helmet";
import { AuthModule } from "../auth/auth.module";
import { RolesGlobalGuard } from "../auth/role/roles.global.guard";
import { SerializeDatesInterceptor } from "../common/interceptors/serialize-dates.interceptor";
import { logV3Failure, refusalForUnparsedBody } from "../v3/core/error-filter";
import { newRequestState } from "../v3/core/request-context";
import { resolveRequestId } from "../v3/core/request-id";
import { V3Tracing } from "../v3/core/tracing";
import { V3Logger } from "../v3/core/v3-logger";

const LEGACY_BODY_LIMIT = "1000mb";
const V3_BODY_LIMIT = "1mb";
const V3_PATH_PREFIX = "/api/v3/";

function isV3Path(url: string): boolean {
  return url.startsWith(V3_PATH_PREFIX);
}

/** Runs `handler` only for v3 paths (`v3: true`) or only for legacy paths. */
function onlyFor(v3: boolean, handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    if (isV3Path(request.url) === v3) {
      void handler(request, response, next);
      return;
    }
    next();
  };
}

/**
 * A v3 body parser. Parser errors happen before Nest routing, so the v3
 * exception filter never sees them: refuse here with the v3 envelope.
 */
function v3BodyParser(
  parser: RequestHandler,
  log: V3Logger,
  tracing: V3Tracing,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    void parser(request, response, (parserError?: unknown) => {
      if (parserError === undefined || parserError === null) {
        next();
        return;
      }
      const requestId = resolveRequestId(request.headers);
      const path = request.path;
      const state = newRequestState(
        requestId,
        tracing.traceId(),
        `${request.method} ${path}`,
      );
      const refusal = refusalForUnparsedBody(parserError);
      logV3Failure(log, state, refusal, parserError);
      response
        .status(refusal.status)
        .setHeader("x-request-id", requestId)
        .json(refusal.body(requestId));
    });
  };
}

/**
 * mark-api's HTTP stack, shared by main.ts and tests. Legacy routes keep a
 * 1000 MB body limit and the legacy globals; v3 routes (`/api/v3/...`) get a
 * 1 MiB limit and skip the legacy interceptors via the v3 scope marker.
 */
export function configureHttpApp(app: INestApplication): void {
  const v3Log = app.get(V3Logger).child("http");
  const tracing = app.get(V3Tracing);

  app.use(onlyFor(false, json({ limit: LEGACY_BODY_LIMIT })));
  app.use(
    onlyFor(false, urlencoded({ limit: LEGACY_BODY_LIMIT, extended: true })),
  );
  app.use(
    onlyFor(true, v3BodyParser(json({ limit: V3_BODY_LIMIT }), v3Log, tracing)),
  );
  app.use(
    onlyFor(
      true,
      v3BodyParser(
        urlencoded({ limit: V3_BODY_LIMIT, extended: true }),
        v3Log,
        tracing,
      ),
    ),
  );

  /** Health endpoints stay at the root for container orchestration. */
  app.setGlobalPrefix("api", {
    exclude: [
      "health",
      "health/liveness",
      "health/readiness",
      "health/integrations",
    ],
  });

  app.enableVersioning({ type: VersioningType.URI });

  app.use(helmet());
  app.use(cookieParser());

  /** whitelist strips properties not declared on legacy DTO classes. */
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalGuards(app.select(AuthModule).get(RolesGlobalGuard));
  app.useGlobalInterceptors(new SerializeDatesInterceptor(app.get(Reflector)));
}
