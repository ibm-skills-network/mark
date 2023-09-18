import { ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";
import { UserRole, UserSession } from "../../interfaces/user.session.interface";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

interface RequestWithUserSession extends Request {
  userSession: UserSession;
}

@Injectable()
export class MockJwtCookieAuthGuard extends AuthGuard("cookie-strategy") {
  constructor(private reflector: Reflector) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canActivate(context: ExecutionContext) {
    const request: RequestWithUserSession = context.switchToHttp().getRequest();

    // Here you can modify the request object to include a temporary user. You can customize this part whenever testing locally.
    request.user = {
      userID: "dev-user",
      role: UserRole.AUTHOR,
      groupID: "test-group-id",
      assignmentID: 1,
      gradingCallbackRequired: false,
    };

    return true;
  }
}
