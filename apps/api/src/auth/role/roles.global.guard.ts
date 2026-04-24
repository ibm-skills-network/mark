import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { UserRole } from "../interfaces/user.session.interface";

export const ROLES_KEY = "roles";
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGlobalGuard implements CanActivate {
  private readonly logger: Logger;

  constructor(
    private reflector: Reflector,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: RolesGlobalGuard.name });
  }

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles) {
      return true;
    }
    const request: {
      method?: string;
      originalUrl?: string;
      userSession?: { role: UserRole; userId?: string };
      adminSession?: { role: UserRole; userId?: string };
    } = context.switchToHttp().getRequest();

    const session = request.userSession || request.adminSession;

    if (!session) {
      this.logger.warn("auth_denied: no session", {
        denial_reason: "no_session",
        required_roles: requiredRoles,
        method: request.method,
        url: request.originalUrl,
      });
      return false;
    }

    if (!requiredRoles.includes(session.role)) {
      this.logger.warn(
        `auth_denied: role mismatch (have=${session.role} need=${requiredRoles.join("|")})`,
        {
          denial_reason: "role_mismatch",
          required_roles: requiredRoles,
          actual_role: session.role,
          user_id: session.userId,
          method: request.method,
          url: request.originalUrl,
        },
      );
      return false;
    }

    return true;
  }
}
