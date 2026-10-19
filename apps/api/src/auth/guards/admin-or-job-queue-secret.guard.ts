import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { getJobQueueSecret } from "src/job-queue/job-payload.crypto";
import { Logger } from "winston";
import { UserSessionRequest } from "../interfaces/user.session.interface";
import { AdminGuard } from "./admin.guard";

const JOB_QUEUE_SECRET_HEADER = "x-job-queue-secret";

/**
 * Admits either an in-cluster caller presenting the shared job-queue secret
 * (e.g. the lti-sync-drain CronJob, which has no admin session) or a verified
 * admin session via AdminGuard. A wrong secret is rejected outright rather than
 * falling through to the admin check.
 */
@Injectable()
export class AdminOrJobQueueSecretGuard implements CanActivate {
  private readonly logger: Logger;

  constructor(
    private readonly adminGuard: AdminGuard,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: AdminOrJobQueueSecretGuard.name,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserSessionRequest>();
    const header = request.headers[JOB_QUEUE_SECRET_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;

    if (provided === undefined) {
      return this.adminGuard.canActivate(context);
    }

    if (this.matchesSecret(provided)) {
      this.logger.info("internal_auth_granted", {
        method: request.method,
        url: request.originalUrl,
      });
      return true;
    }

    this.logger.warn("internal_auth_denied: invalid job queue secret", {
      denial_reason: "invalid_job_queue_secret",
      method: request.method,
      url: request.originalUrl,
      client_ip: request.get("true-client-ip"),
    });
    return false;
  }

  private matchesSecret(provided: string): boolean {
    const expected = Buffer.from(getJobQueueSecret());
    const actual = Buffer.from(provided);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
