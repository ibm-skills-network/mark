import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { UserSessionMiddleware } from "./middleware/user.session.middleware";
import { RolesGlobalGuard } from "./role/roles.global.guard";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
  ],
  providers: [
    UserSessionMiddleware,
    {
      provide: RolesGlobalGuard,
      useClass: RolesGlobalGuard,
    },
  ],
})
export class AuthModule {}
