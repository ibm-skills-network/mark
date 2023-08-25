import { JwtAdminAuthGuard } from "./jwt.admin.auth.guard";
import { MockJwtAdminAuthGuard } from "./mock.jwt.admin.auth.guard";

export function getAdminAuthGuard():
  | typeof JwtAdminAuthGuard
  | typeof MockJwtAdminAuthGuard {
  return process.env.NODE_ENV !== "production" &&
    process.env.AUTH_DISABLED === "true"
    ? MockJwtAdminAuthGuard
    : JwtAdminAuthGuard;
}
