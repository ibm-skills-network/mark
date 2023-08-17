import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtConfigService } from "../..//auth/jwt/jwt.config.service";
import { AuthModule } from "../../auth/auth.module";
import { JwtAdminStrategy } from "../../auth/jwt/admin/jwt.admin.strategy";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [AuthModule, PassportModule],
  controllers: [AdminController],
  providers: [AdminService, JwtConfigService, JwtAdminStrategy],
})
export class AdminModule {}
