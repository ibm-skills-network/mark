import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Observable, tap } from "rxjs";
import { V3RequestContexts, type V3HttpResponse } from "./http-context";
import { elapsedMs, runInRequest } from "./request-context";
import { V3Logger } from "./v3-logger";

/**
 * Outermost v3 interceptor: runs the handler inside the request's context
 * (so every log line below it carries the ids), echoes `x-request-id` and
 * writes the outcome line for successful requests. Failures are written by
 * the v3 exception filter.
 */
@Injectable()
export class V3ContextInterceptor implements NestInterceptor {
  private readonly log: V3Logger;

  constructor(
    private readonly contexts: V3RequestContexts,
    private readonly adapterHost: HttpAdapterHost,
    logger: V3Logger,
  ) {
    this.log = logger.child("http");
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const state = this.contexts.forExecution(context);
    const response = context.switchToHttp().getResponse<V3HttpResponse>();
    this.adapterHost.httpAdapter.setHeader(
      response,
      "x-request-id",
      state.context.request_id,
    );
    // Calling and subscribing inside the context makes the handler and every
    // operator after it (response contract, outcome line) see the request.
    const handled = runInRequest(state, () => next.handle());
    return new Observable<unknown>((subscriber) =>
      runInRequest(state, () => handled.subscribe(subscriber)),
    ).pipe(
      tap({
        complete: () =>
          runInRequest(state, () =>
            this.log.info("v3.request.completed", {
              route: state.route,
              status: response.statusCode,
              outcome: "ok",
              duration_ms: elapsedMs(state),
            }),
          ),
      }),
    );
  }
}
