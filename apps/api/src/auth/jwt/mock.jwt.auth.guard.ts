import { ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";
import { User, UserRole } from "../interfaces/user.interface";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

interface RequestWithUser extends Request {
  user: User;
}

@Injectable()
export class MockJwtAuthGuard extends AuthGuard("jwt") {
  constructor(private reflector: Reflector) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canActivate(context: ExecutionContext) {
    const request: RequestWithUser = context.switchToHttp().getRequest();

    // Here you can modify the request object to include a temporary user. You can customize this part whenever testing locally.
    request.user = {
      userID: "dev-user",
      role: UserRole.LEARNER,
      groupID: "test-group-id",
      assignmentID: 1,
      gradingCallbackRequired: false,
    };

    return true;
  }
}
