import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, map } from "rxjs";
import type { ZodType } from "zod";
import { V3Error } from "./errors";
import { V3Logger } from "./v3-logger";
import { issueSummary } from "./zod.pipe";

/** Handler metadata set by @V3Route: the zod schema of the response body. */
export const V3_RESPONSE_METADATA = "mark:v3-response";

/**
 * Parses every handler result with its route's schema: the body keeps the
 * schema's key order and drops unknown keys. A result that does not parse
 * is a 500, never a partial body.
 */
@Injectable()
export class V3ResponseContractInterceptor implements NestInterceptor {
  private readonly log: V3Logger;

  constructor(
    private readonly reflector: Reflector,
    logger: V3Logger,
  ) {
    this.log = logger.child("response-contract");
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<ZodType | undefined>(
      V3_RESPONSE_METADATA,
      context.getHandler(),
    );
    if (schema === undefined) {
      // V3Module refuses to start with such a route; this is the backstop.
      throw V3Error.internal("response_contract_missing");
    }
    return next.handle().pipe(
      map((data: unknown) => {
        const result = schema.safeParse(data);
        if (result.success) return result.data;
        this.log.error("v3.response_contract_violation", {
          issues: issueSummary(result.error),
        });
        throw V3Error.internal("response_contract_violation");
      }),
    );
  }
}
