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
      userId: "dev-user",
      role: UserRole.AUTHOR,
      groupId: "autogen-faculty-v1-course-v1-IND-AI0103EN-v1",
      assignmentId: 1,
      gradingCallbackRequired: false,
      returnUrl: "https://skills.network",
      launch_presentation_locale: "en",
    };

    return true;
  }
}
