import type { Logger } from "winston";
import {
  UserRole,
  type UserSession,
} from "../auth/interfaces/user.session.interface";

export type Backend = "rust" | "legacy";

export interface DownstreamDecision {
  service: Backend;
  // Set when the request matched an enabled family, whichever backend answers.
  family?: string;
}

export interface RustRoutingConfig {
  endpoint?: string;
  families: ReadonlySet<string>;
}

interface RouteMatcher {
  method: string;
  pattern: RegExp;
}

// Ids are digit-only so a crafted segment can never widen a match.
const ID = String.raw`\d+`;
const ASSIGNMENT = String.raw`/api/v2/assignments/${ID}`;

const exact = (method: string, path: string): RouteMatcher => ({
  method,
  pattern: new RegExp(`^${path}$`),
});

export const ROUTE_FAMILIES: ReadonlyMap<string, readonly RouteMatcher[]> =
  new Map([
    [
      "learner-reads",
      [
        exact("GET", ASSIGNMENT),
        exact("GET", `${ASSIGNMENT}/languages`),
        exact("GET", `${ASSIGNMENT}/attempts`),
        exact("GET", `${ASSIGNMENT}/attempts/${ID}`),
      ],
    ],
    [
      "learner-attempt-writes",
      [
        exact("POST", `${ASSIGNMENT}/attempts`),
        exact("POST", `${ASSIGNMENT}/attempts/${ID}/abandon`),
      ],
    ],
  ]);

// The Rust API only serves learner response shapes so far.
const RUST_ROLES: ReadonlySet<string> = new Set([UserRole.LEARNER]);

const LEGACY: DownstreamDecision = { service: "legacy" };

export function parseRustRoutingConfig(
  environment: NodeJS.ProcessEnv,
  logger: Pick<Logger, "warn" | "error" | "info">,
): RustRoutingConfig {
  // Trailing slashes would double up with originalUrl's leading slash.
  const endpoint =
    environment.MARK_RUST_API_ENDPOINT?.trim().replace(/\/+$/, "") || undefined;
  const requested = (environment.MARK_RUST_ROUTES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const families = new Set<string>();
  for (const name of requested) {
    if (ROUTE_FAMILIES.has(name)) {
      families.add(name);
    } else {
      logger.warn("Ignoring unknown rust route family", { family: name });
    }
  }

  if (families.size > 0 && !endpoint) {
    // Misconfiguration must never fail learner requests; fall back to legacy.
    logger.error(
      "MARK_RUST_ROUTES is set but MARK_RUST_API_ENDPOINT is not; routing everything to the legacy API",
      { families: [...families] },
    );
    return { endpoint: undefined, families: new Set() };
  }

  if (families.size > 0) {
    logger.info("Rust API routing enabled", { families: [...families] });
  }
  return { endpoint, families };
}

export function matchFamily(
  method: string | undefined,
  originalUrl: string | undefined,
  families: ReadonlySet<string>,
): string | undefined {
  if (!method || !originalUrl || families.size === 0) {
    return undefined;
  }
  const path = originalUrl.split(/[#?]/, 1)[0];
  const upperMethod = method.toUpperCase();
  for (const family of families) {
    const matchers = ROUTE_FAMILIES.get(family) ?? [];
    if (
      matchers.some((m) => m.method === upperMethod && m.pattern.test(path))
    ) {
      return family;
    }
  }
  return undefined;
}

export function resolveDownstream(
  request: {
    method?: string;
    originalUrl?: string;
    user?: Pick<UserSession, "role">;
  },
  config: RustRoutingConfig,
): DownstreamDecision {
  if (!config.endpoint) {
    return LEGACY;
  }
  const family = matchFamily(
    request.method,
    request.originalUrl,
    config.families,
  );
  if (!family) {
    return LEGACY;
  }
  const role = request.user?.role;
  if (role === undefined || !RUST_ROLES.has(role)) {
    return { service: "legacy", family };
  }
  return { service: "rust", family };
}
