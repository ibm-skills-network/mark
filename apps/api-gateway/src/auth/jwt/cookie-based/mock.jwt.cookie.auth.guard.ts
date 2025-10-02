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

    request.user = {
      userId: "magdy.hafez@ibm.com1",
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
