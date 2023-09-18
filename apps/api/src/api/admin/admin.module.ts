import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { PrismaService } from "src/prisma.service";
import { AuthModule } from "../../auth/auth.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [AuthModule, PassportModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService],
})
export class AdminModule {}
