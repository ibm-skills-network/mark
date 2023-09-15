// auth.guard.ts
import { Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class JwtAdminAuthGuard extends AuthGuard("jwt-admin") {
  constructor(private reflector: Reflector) {
    super();
  }
}
