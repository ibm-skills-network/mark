import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { getJobQueueSecret } from "./job-payload.crypto";

export const JOB_QUEUE_SECRET_HEADER = "x-job-queue-secret";

/**
 * Admits only in-cluster callers presenting the shared job-queue secret.
 * Runs as a guard so an unauthenticated caller is refused before its body or
 * query is validated, and learns nothing about the expected shape.
 */
@Injectable()
export class JobQueueSecretGuard implements CanActivate {
  private readonly logger: Logger;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: JobQueueSecretGuard.name });
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[JOB_QUEUE_SECRET_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;

    if (provided && matchesJobQueueSecret(provided)) {
      return true;
    }

    this.logger.warn("internal_auth_denied: invalid job queue secret", {
      denial_reason:
        provided === undefined
          ? "missing_job_queue_secret"
          : "invalid_job_queue_secret",
      method: request.method,
      url: request.originalUrl,
      client_ip: request.get("true-client-ip"),
    });
    throw new ForbiddenException("Invalid job queue secret");
  }
}

function matchesJobQueueSecret(provided: string): boolean {
  const expected = Buffer.from(getJobQueueSecret());
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
