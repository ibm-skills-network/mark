import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { describeError, V3Error } from "./errors";
import { V3RequestContexts } from "./http-context";
import {
  elapsedMs,
  runInRequest,
  type V3RequestState,
} from "./request-context";
import { V3Logger } from "./v3-logger";

/** Maps anything thrown on a v3 route onto a V3Error. */
export function toV3Error(exception: unknown): V3Error {
  if (exception instanceof V3Error) return exception;
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const reason = `http_${status}`;
    switch (status) {
      case 400: {
        return V3Error.badRequest(reason);
      }
      case 401: {
        return V3Error.unauthorized(reason);
      }
      case 403: {
        return V3Error.forbidden(reason);
      }
      case 404: {
        return V3Error.notFound(reason);
      }
      case 413: {
        return V3Error.payloadTooLarge(reason);
      }
      default: {
        return V3Error.internal(reason);
      }
    }
  }
  return V3Error.internal("unexpected_error");
}

/** A refusal for a v3 body the parser rejected before routing. */
export function refusalForUnparsedBody(parserError: unknown): V3Error {
  const status: unknown =
    typeof parserError === "object" && parserError !== null
      ? Reflect.get(parserError, "status")
      : undefined;
  return status === 413
    ? V3Error.payloadTooLarge("body_too_large")
    : V3Error.badRequest("body_unparseable");
}

/**
 * Logs a v3 failure inside the request's context: `v3.request.rejected`
 * (warn) for 4xx, `v3.request.failed` (error) for 5xx, then the request's
 * `v3.request.completed` outcome line.
 */
export function logV3Failure(
  log: V3Logger,
  state: V3RequestState,
  error: V3Error,
  cause: unknown,
): void {
  runInRequest(state, () => {
    const failed = error.status >= 500;
    const outcome = failed ? "failed" : "rejected";
    if (failed) {
      log.error("v3.request.failed", {
        outcome,
        reason: error.reason,
        status: error.status,
        error: describeError(cause),
      });
    } else {
      log.warn("v3.request.rejected", {
        outcome,
        reason: error.reason,
        status: error.status,
        code: error.code,
        ...error.details,
      });
    }
    const completed = {
      route: state.route,
      status: error.status,
      outcome,
      duration_ms: elapsedMs(state),
    };
    if (failed) log.error("v3.request.completed", completed);
    else log.warn("v3.request.completed", completed);
  });
}

/**
 * v3's exception filter, attached by @V3Controller so it takes precedence
 * over the global legacy filter. Bodies are the v3 envelope with a generic
 * message; the cause is logged, never returned.
 */
@Catch()
@Injectable()
export class V3ExceptionFilter implements ExceptionFilter {
  private readonly log: V3Logger;

  constructor(
    private readonly contexts: V3RequestContexts,
    private readonly adapterHost: HttpAdapterHost,
    logger: V3Logger,
  ) {
    this.log = logger.child("http");
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const state = this.contexts.forHost(host);
    const error = toV3Error(exception);
    logV3Failure(this.log, state, error, exception);

    const requestId = state.context.request_id;
    const response: unknown = host.switchToHttp().getResponse();
    const { httpAdapter } = this.adapterHost;
    httpAdapter.setHeader(response, "x-request-id", requestId);
    httpAdapter.reply(response, error.body(requestId), error.status);
  }
}
