import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";
import { AdminOverrideController } from "./admin-override.controller";
import { AdminOverrideService } from "./admin-override.service";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";
import { JwtConfigService } from "../auth/jwt/jwt.config.service";

@Module({
  imports: [AuthModule, JwtModule.register({})],
  controllers: [ApiController, AdminOverrideController],
  providers: [ApiService, AdminOverrideService, JwtConfigService],
})
export class ApiModule {}
