import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { DynamicJwtBearerTokenAuthGuard } from "./jwt/bearer-token-based/dynamic.jwt.bearer.token.auth.guard";
import { JwtBearerTokenAuthGuard } from "./jwt/bearer-token-based/jwt.bearer.token.auth.guard";
import { JwtBearerTokenStrategy } from "./jwt/bearer-token-based/jwt.bearer.token.strategy";
import { MockJwtBearerTokenAuthGuard } from "./jwt/bearer-token-based/mock.jwt.bearer.token.auth.guard";
import { DynamicJwtCookieAuthGuard } from "./jwt/cookie-based/dynamic.jwt.cookie.auth.guard";
import { JwtCookieAuthGuard } from "./jwt/cookie-based/jwt.cookie.auth.guard";
import { JwtCookieStrategy } from "./jwt/cookie-based/jwt.cookie.strategy";
import { MockJwtCookieAuthGuard } from "./jwt/cookie-based/mock.jwt.cookie.auth.guard";
import { JwtConfigService } from "./jwt/jwt.config.service";

@Module({
  imports: [PassportModule.register({}), JwtModule.register({})],
  providers: [
    JwtCookieAuthGuard,
    MockJwtCookieAuthGuard,
    DynamicJwtCookieAuthGuard,
    JwtBearerTokenAuthGuard,
    MockJwtBearerTokenAuthGuard,
    DynamicJwtBearerTokenAuthGuard,
    JwtCookieStrategy,
    JwtBearerTokenStrategy,
    JwtConfigService,
  ],
  exports: [
    JwtCookieAuthGuard,
    MockJwtCookieAuthGuard,
    DynamicJwtCookieAuthGuard,
    JwtBearerTokenAuthGuard,
    MockJwtBearerTokenAuthGuard,
    DynamicJwtBearerTokenAuthGuard,
  ],
})
export class AuthModule {}
