import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminAssumeRoleController } from "./admin-assume-role.controller";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";

@Module({
  imports: [AuthModule],
  // Registered before ApiController so its catch-all route cannot shadow it.
  controllers: [AdminAssumeRoleController, ApiController],
  providers: [ApiService],
})
export class ApiModule {}
