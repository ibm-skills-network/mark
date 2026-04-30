import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../interfaces/user.session.interface";
import { AdminVerificationService } from "../services/admin-verification.service";

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger: Logger;

  constructor(
    private readonly adminVerificationService: AdminVerificationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: AdminGuard.name });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();

    const adminTokenHeader =
      request.headers["x-admin-token"] || request.headers["admin-token"];

    const adminToken = Array.isArray(adminTokenHeader)
      ? adminTokenHeader[0]
      : adminTokenHeader;

    if (!adminToken) {
      this.logger.warn("admin_auth_denied: no token header", {
        denial_reason: "no_admin_token",
        method: request.method,
        url: request.originalUrl,
        client_ip: request.get("true-client-ip"),
      });
      throw new UnauthorizedException(
        "Admin authentication required. Please login with email verification.",
      );
    }

    const userInfo =
      await this.adminVerificationService.verifyAdminSession(adminToken);

    if (!userInfo) {
      this.logger.warn("admin_auth_denied: invalid or expired session", {
        denial_reason: "invalid_admin_token",
        method: request.method,
        url: request.originalUrl,
        client_ip: request.get("true-client-ip"),
      });
      throw new UnauthorizedException(
        "Invalid or expired admin session. Please login again.",
      );
    }

    this.logger.debug("admin_auth_granted", {
      admin_email: userInfo.email,
      admin_role: userInfo.role,
      method: request.method,
      url: request.originalUrl,
    });

    request.userSession = {
      ...request.userSession,
      userId: userInfo.email.toLowerCase(),
      role: userInfo.role === "admin" ? UserRole.ADMIN : UserRole.AUTHOR,
      sessionToken: adminToken,
    };

    return true;
  }
}
