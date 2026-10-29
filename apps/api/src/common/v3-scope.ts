import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

/**
 * Class metadata set by @V3Controller. Legacy globals read it through
 * isV3Route and leave v3 responses untouched.
 */
export const V3_SCOPE_METADATA = "mark:v3-scope";

/** The URI version v3 controllers are served under: `/api/v3/...`. */
export const V3_VERSION = "3";

export function isV3Route(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  return (
    reflector.getAllAndOverride<boolean>(V3_SCOPE_METADATA, [
      context.getClass(),
    ]) === true
  );
}
