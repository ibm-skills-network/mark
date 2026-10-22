import { GradingContractError } from "backend-contracts";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import {
  JobExecutionRequest,
  JobExecutorService,
} from "./job-executor.service";
import { getJobQueueSecret } from "./job-payload.crypto";

@Controller("internal/jobs")
export class JobExecutorController {
  constructor(private readonly jobExecutorService: JobExecutorService) {}

  @Post("execute")
  @HttpCode(200)
  async executeJob(
    @Headers("x-job-queue-secret") secretHeader: string | string[] | undefined,
    @Body() request: JobExecutionRequest,
  ): Promise<{ ok: true }> {
    if (!this.isAuthorized(secretHeader)) {
      throw new ForbiddenException("Invalid job queue secret");
    }

    try {
      await this.jobExecutorService.executeJob(request);
    } catch (error: unknown) {
      if (error instanceof GradingContractError) {
        throw new BadRequestException({
          code: error.code,
          boundary: error.boundary,
          message: error.message,
          retryable: false,
        });
      }
      throw error;
    }
    return { ok: true };
  }

  private isAuthorized(secretHeader: string | string[] | undefined): boolean {
    const providedSecret = Array.isArray(secretHeader)
      ? secretHeader[0]
      : secretHeader;
    if (!providedSecret) {
      return false;
    }

    const expected = Buffer.from(getJobQueueSecret());
    const provided = Buffer.from(providedSecret);
    return (
      provided.length === expected.length && timingSafeEqual(provided, expected)
    );
  }
}
