import { Global, Module } from "@nestjs/common";
import { OperationProducerService } from "./operation-producer.service";
import { RustJobsConfig } from "./rust-jobs.config";

// Global like JobQueueModule: enqueue sites live in many feature modules.
@Global()
@Module({
  providers: [RustJobsConfig, OperationProducerService],
  exports: [RustJobsConfig, OperationProducerService],
})
export class OperationsModule {}
