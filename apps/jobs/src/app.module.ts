import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { WinstonModule } from "nest-winston";
import { AdminModule } from "../../api/src/api/admin/admin.module";
import { AssignmentModuleV1 } from "../../api/src/api/assignment/v1/modules/assignment.module";
import { AssignmentModuleV2 } from "../../api/src/api/assignment/v2/modules/assignment.module";
import { AttemptModule } from "../../api/src/api/attempt/attempt.module";
import { CommonModule } from "../../api/src/common/common.module";
import { DatabaseModule } from "../../api/src/database/database.module";
import { winstonOptions } from "../../api/src/logger/config";
import { SharedModule } from "../../api/src/shared.module";
import { JobWorkerService } from "./job-worker.service";

@Module({
  imports: [
    ConfigModule.forRoot(),
    WinstonModule.forRoot(winstonOptions),
    CommonModule,
    DatabaseModule,
    SharedModule,
    AssignmentModuleV1,
    AssignmentModuleV2,
    AttemptModule,
    AdminModule,
  ],
  providers: [JobWorkerService],
})
export class JobsAppModule {}
