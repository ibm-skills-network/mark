import { Module } from "@nestjs/common";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";
import { AssignmentModule } from "./assignment/assignment.module";

@Module({
  controllers: [ApiController],
  providers: [ApiService],
  imports: [AssignmentModule],
})
export class ApiModule {}
