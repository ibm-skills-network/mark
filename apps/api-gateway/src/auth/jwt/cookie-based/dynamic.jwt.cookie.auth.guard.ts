import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Observable } from "rxjs";
import { JwtCookieAuthGuard } from "./jwt.cookie.auth.guard";
import { MockJwtCookieAuthGuard } from "./mock.jwt.cookie.auth.guard";

@Injectable()
export class DynamicJwtCookieAuthGuard implements CanActivate {
  constructor(
    private readonly realGuard: JwtCookieAuthGuard,
    private readonly mockGuard: MockJwtCookieAuthGuard,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return process.env.NODE_ENV !== "production" &&
      process.env.AUTH_DISABLED === "true"
      ? this.mockGuard.canActivate(context)
      : this.realGuard.canActivate(context);
  }
}
