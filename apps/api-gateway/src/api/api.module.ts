import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";
import { AdminOverrideController } from "./admin-override.controller";
import { AdminOverrideService } from "./admin-override.service";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";
import { JwtConfigService } from "../auth/jwt/jwt.config.service";
import { PublicAuthThrottlerGuard } from "./public-auth-throttler.guard";

@Module({
  imports: [AuthModule, JwtModule.register({})],
  controllers: [AdminOverrideController, ApiController],
  providers: [
    ApiService,
    AdminOverrideService,
    JwtConfigService,
    PublicAuthThrottlerGuard,
  ],
})
export class ApiModule {}
