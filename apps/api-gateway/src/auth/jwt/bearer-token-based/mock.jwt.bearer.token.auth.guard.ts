import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";
import { UserRole, UserSession } from "../../interfaces/user.session.interface";

interface RequestWithUserSession extends Request {
  userSession: UserSession;
}

@Injectable()
export class MockJwtBearerTokenAuthGuard extends AuthGuard(
  "bearer-token-strategy",
) {
  constructor(private reflector: Reflector) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canActivate(context: ExecutionContext) {
    const request: RequestWithUserSession = context.switchToHttp().getRequest();

    request.user = {
      userId: "testuser@test.com",
      role: UserRole.AUTHOR,
      groupId: "text-group-id",
      assignmentId: 1,
      gradingCallbackRequired: false,
      returnUrl: "https://skills.network",
      launch_presentation_locale: "en",
      admin: true,
    };
    return true;
  }
}
