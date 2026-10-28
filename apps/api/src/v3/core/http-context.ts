import {
  ArgumentsHost,
  ExecutionContext,
  Injectable,
  RequestMethod,
} from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { V3_VERSION } from "../../common/v3-scope";
import { Reflector } from "@nestjs/core";
import type { Principal } from "./principal";
import { newRequestState, type V3RequestState } from "./request-context";
import { resolveRequestId, type HeaderBag } from "./request-id";
import { V3Tracing } from "./tracing";

/** What v3 reads from a request; true of both Express and Fastify requests. */
export type V3HttpRequest = { headers: HeaderBag; method?: string };
/** What v3 reads from a response; true of both Express and Fastify replies. */
export type V3HttpResponse = { statusCode: number };

const states = new WeakMap<object, V3RequestState>();
const principals = new WeakMap<object, Principal>();

function firstPath(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function methodName(value: unknown): string {
  return typeof value === "number" && RequestMethod[value] !== undefined
    ? RequestMethod[value]
    : "UNKNOWN";
}

export function principalFor(request: object): Principal | undefined {
  return principals.get(request);
}

/**
 * Creates each v3 request's state once (request id, trace id, route) and
 * hands the same object to the guard, interceptors and filter, so a refusal
 * before the interceptors run still logs with the request's ids.
 */
@Injectable()
export class V3RequestContexts {
  constructor(
    private readonly tracing: V3Tracing,
    private readonly reflector: Reflector,
  ) {}

  forExecution(context: ExecutionContext): V3RequestState {
    const request = context.switchToHttp().getRequest<V3HttpRequest>();
    return states.get(request) ?? this.create(request, this.routeOf(context));
  }

  /** For filters, whose host carries no handler when a guard refused. */
  forHost(host: ArgumentsHost): V3RequestState {
    const request = host.switchToHttp().getRequest<V3HttpRequest>();
    return (
      states.get(request) ??
      this.create(request, `${request.method ?? "UNKNOWN"} (unrouted)`)
    );
  }

  attachPrincipal(
    request: object,
    state: V3RequestState,
    principal: Principal,
  ): void {
    principals.set(request, principal);
    state.context.user_id = principal.userId;
    state.context.role = principal.role;
    state.context.assignment_id = principal.assignmentId;
    this.tracing.tag({
      request_id: state.context.request_id,
      user_id: principal.userId,
      role: principal.role,
      assignment_id: principal.assignmentId,
    });
  }

  private create(request: V3HttpRequest, route: string): V3RequestState {
    const state = newRequestState(
      resolveRequestId(request.headers),
      this.tracing.traceId(),
      route,
    );
    states.set(request, state);
    this.tracing.tag({ request_id: state.context.request_id });
    return state;
  }

  private routeOf(context: ExecutionContext): string {
    const handler = context.getHandler();
    const segments = [
      "api",
      `v${V3_VERSION}`,
      firstPath(this.reflector.get<unknown>(PATH_METADATA, context.getClass())),
      firstPath(this.reflector.get<unknown>(PATH_METADATA, handler)),
    ]
      .flatMap((path) => path.split("/"))
      .filter((segment) => segment !== "");
    const method = methodName(
      this.reflector.get<unknown>(METHOD_METADATA, handler),
    );
    return `${method} /${segments.join("/")}`;
  }
}
