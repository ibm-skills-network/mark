import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";

@Module({
  imports: [AuthModule],
  controllers: [ApiController],
  providers: [ApiService],
})
export class ApiModule {}
