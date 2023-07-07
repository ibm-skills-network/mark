import { ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class MockJwtAuthGuard extends AuthGuard("jwt") {
  constructor(private reflector: Reflector) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canActivate(context: ExecutionContext) {
    const request: Request = context.switchToHttp().getRequest();

    // Here you can modify the request object to include a temporary user. You can customize this part.
    request.user = {};

    return true;
  }
}
