import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "../interfaces/user.session.interface";

export const ROLES_KEY = "roles";
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGlobalGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles) {
      return true;
    }
    const request: {
      userSession?: { role: UserRole };
      adminSession?: { role: UserRole };
    } = context.switchToHttp().getRequest();

    const session = request.userSession || request.adminSession;

    if (!session) {
      return false;
    }

    return requiredRoles.includes(session.role);
  }
}
