import { Global, Module } from "@nestjs/common";
import { FileProcessingBudgetService } from "./services/file-processing-budget.service";

@Global()
@Module({
  providers: [FileProcessingBudgetService],
  exports: [FileProcessingBudgetService],
})
export class FileProcessingBudgetModule {}
