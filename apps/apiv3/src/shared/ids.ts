import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

const VALID_ID = /^[\x21-\x7E]{1,128}$/;

export function newRequestId(): string {
  return randomUUID();
}

export function requestIdFrom(headers: IncomingHttpHeaders): string {
  for (const name of ["akamai-grn", "x-request-id"]) {
    const raw = headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined && VALID_ID.test(value)) return value;
  }
  return newRequestId();
}
