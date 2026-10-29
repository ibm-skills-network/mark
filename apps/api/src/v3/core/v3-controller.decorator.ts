import {
  applyDecorators,
  Controller,
  SetMetadata,
  UseFilters,
  UseInterceptors,
} from "@nestjs/common";
import type { ZodType } from "zod";
import { V3_SCOPE_METADATA, V3_VERSION } from "../../common/v3-scope";
import { V3ContextInterceptor } from "./context.interceptor";
import { V3ExceptionFilter } from "./error-filter";
import {
  V3_RESPONSE_METADATA,
  V3ResponseContractInterceptor,
} from "./response-contract.interceptor";

/**
 * A v3 controller served at `/api/v3/<path>`. Marks the class so legacy
 * globals skip it and attaches v3's exception filter, request context and
 * response contract.
 */
export function V3Controller(path: string): ClassDecorator {
  return applyDecorators(
    Controller({ path, version: V3_VERSION }),
    SetMetadata(V3_SCOPE_METADATA, true),
    UseFilters(V3ExceptionFilter),
    UseInterceptors(V3ContextInterceptor, V3ResponseContractInterceptor),
  );
}

/** Every v3 route declares the zod schema of its response body. */
export function V3Route(options: { response: ZodType }): MethodDecorator {
  return SetMetadata(V3_RESPONSE_METADATA, options.response);
}
