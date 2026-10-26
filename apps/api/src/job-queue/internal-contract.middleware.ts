import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";

/**
 * The version of the request and response shapes the `/api/internal/*`
 * endpoints speak. In-cluster callers that are deployed separately from this
 * service (the Rust API) require a minimum and treat an older or missing
 * header as "not rolled yet", answering their own clients with a retryable
 * 503 instead of acting on a shape they do not understand.
 *
 * Bump it only when an internal request or response shape changes, and keep
 * the previous shape accepted for one release so the two services can roll
 * in either order.
 */
export const INTERNAL_CONTRACT_VERSION = 1;
export const INTERNAL_CONTRACT_HEADER = "x-mark-internal-contract";

/** Stamps every `/api/internal/*` answer, including error answers. */
@Injectable()
export class InternalContractMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction) {
    response.setHeader(
      INTERNAL_CONTRACT_HEADER,
      String(INTERNAL_CONTRACT_VERSION),
    );
    next();
  }
}
