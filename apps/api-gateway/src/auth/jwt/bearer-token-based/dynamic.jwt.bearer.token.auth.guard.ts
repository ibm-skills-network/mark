import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Observable } from "rxjs";
import { JwtBearerTokenAuthGuard } from "./jwt.bearer.token.auth.guard";
import { MockJwtBearerTokenAuthGuard } from "./mock.jwt.bearer.token.auth.guard";

@Injectable()
export class DynamicJwtBearerTokenAuthGuard implements CanActivate {
  constructor(
    private readonly realGuard: JwtBearerTokenAuthGuard,
    private readonly mockGuard: MockJwtBearerTokenAuthGuard
  ) {}

  canActivate(
    context: ExecutionContext
  ): boolean | Promise<boolean> | Observable<boolean> {
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.AUTH_DISABLED === "true"
    ) {
      return this.mockGuard.canActivate(context);
    } else {
      return this.realGuard.canActivate(context);
    }
  }
}
