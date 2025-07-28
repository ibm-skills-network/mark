import { Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class JwtBearerTokenAuthGuard extends AuthGuard(
  "bearer-token-strategy",
) {
  constructor(private reflector: Reflector) {
    super();
  }
}
