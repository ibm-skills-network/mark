import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import {
  principalFor,
  V3RequestContexts,
  type V3HttpRequest,
} from "./http-context";
import { parseUserSession, type Principal } from "./principal";
import { headerValue } from "./request-id";

/**
 * Requires the gateway's `user-session` header. A refusal is a V3Error
 * carrying only the enumerated reason; the v3 filter logs and answers it.
 */
@Injectable()
export class V3PrincipalGuard implements CanActivate {
  constructor(private readonly contexts: V3RequestContexts) {}

  canActivate(context: ExecutionContext): boolean {
    const state = this.contexts.forExecution(context);
    const request = context.switchToHttp().getRequest<V3HttpRequest>();
    const principal = parseUserSession(
      headerValue(request.headers, "user-session"),
    );
    this.contexts.attachPrincipal(request, state, principal);
    return true;
  }
}

/** Applies the principal guard to a v3 route or controller. */
export const UsePrincipal = (): MethodDecorator & ClassDecorator =>
  UseGuards(V3PrincipalGuard);

/** The request's Principal; the route must use UsePrincipal(). */
export const V3Principal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const principal = principalFor(context.switchToHttp().getRequest<object>());
    if (principal === undefined) {
      throw new Error("V3Principal() read on a route without UsePrincipal()");
    }
    return principal;
  },
);
