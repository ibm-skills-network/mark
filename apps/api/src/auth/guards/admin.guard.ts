import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  UserRole,
  UserSessionRequest,
} from "../interfaces/user.session.interface";
import { AdminVerificationService } from "../services/admin-verification.service";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly adminVerificationService: AdminVerificationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();

    const adminTokenHeader =
      request.headers["x-admin-token"] || request.headers["admin-token"];

    const adminToken = Array.isArray(adminTokenHeader)
      ? adminTokenHeader[0]
      : adminTokenHeader;

    if (!adminToken) {
      throw new UnauthorizedException(
        "Admin authentication required. Please login with email verification.",
      );
    }

    const userInfo =
      await this.adminVerificationService.verifyAdminSession(adminToken);

    if (!userInfo) {
      throw new UnauthorizedException(
        "Invalid or expired admin session. Please login again.",
      );
    }

    request.userSession = {
      ...request.userSession,
      userId: userInfo.email.toLowerCase(),
      role: userInfo.role === "admin" ? UserRole.ADMIN : UserRole.AUTHOR,
      sessionToken: adminToken,
    };

    return true;
  }
}
