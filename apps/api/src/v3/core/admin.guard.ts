import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import { AdminVerificationService } from "../../auth/services/admin-verification.service";
import { V3Error } from "./errors";
import { V3RequestContexts, type V3HttpRequest } from "./http-context";
import { headerValue } from "./request-id";

/**
 * Requires a live admin session in `x-admin-token` (the admin dashboard's
 * login). The admin becomes the request's Principal, so V3Principal() and
 * request logs carry their email. The token is never logged.
 */
@Injectable()
export class V3AdminGuard implements CanActivate {
  constructor(
    private readonly contexts: V3RequestContexts,
    private readonly verification: AdminVerificationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const state = this.contexts.forExecution(context);
    const request = context.switchToHttp().getRequest<V3HttpRequest>();
    const token = headerValue(request.headers, "x-admin-token")?.trim();
    if (!token) throw V3Error.unauthorized("admin_token_missing");

    const session = await this.verification.verifyAdminSession(token);
    if (!session) throw V3Error.unauthorized("admin_session_invalid");
    if (session.role !== "admin") throw V3Error.forbidden("not_admin");

    this.contexts.attachPrincipal(request, state, {
      userId: session.email,
      role: "admin",
      groupId: null,
      assignmentId: null,
      gradingCallbackRequired: false,
      raw: {},
    });
    return true;
  }
}

/** Applies the admin guard to a v3 route or controller. */
export const UseAdmin = (): MethodDecorator & ClassDecorator =>
  UseGuards(V3AdminGuard);
