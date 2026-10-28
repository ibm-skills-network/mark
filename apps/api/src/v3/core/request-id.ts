import { randomUUID } from "node:crypto";

// Letters, digits, `.`, `_`, `:` and `-`, at most 128 characters.
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

export type HeaderBag = Record<string, string | string[] | undefined>;

export function headerValue(
  headers: HeaderBag,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The request id Akamai or the gateway assigned (akamai-grn first, then
 * x-request-id) when it is safe to log and echo; otherwise a fresh UUID.
 */
export function resolveRequestId(headers: HeaderBag): string {
  for (const name of ["akamai-grn", "x-request-id"]) {
    const value = headerValue(headers, name);
    if (value !== undefined && SAFE_REQUEST_ID.test(value)) return value;
  }
  return randomUUID();
}
