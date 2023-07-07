import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { JwtConfigService } from "./jwt/jwt.config.service";
import { JwtGlobalAuthGuard } from "./jwt/jwt.global.auth.guard";
import { JwtStrategy } from "./jwt/jwt.strategy";
import { MockJwtAuthGuard } from "./jwt/mock.jwt.auth.guard";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
  ],
  providers: [
    {
      provide: JwtStrategy,
      useClass: JwtStrategy,
    },
    {
      provide: JwtGlobalAuthGuard,
      useClass:
        process.env.NODE_ENV !== "production" &&
        process.env.AUTH_DISABLED === "true"
          ? MockJwtAuthGuard
          : JwtGlobalAuthGuard,
    },
    JwtConfigService,
  ],
})
export class AuthModule {}
