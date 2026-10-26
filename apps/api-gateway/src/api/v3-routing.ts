import type { Logger } from "winston";
import {
  UserRole,
  type UserSession,
} from "../auth/interfaces/user.session.interface";

export type Backend = "v3" | "legacy";

export interface DownstreamDecision {
  service: Backend;
  // Set when the request matched an enabled family, whichever backend answers.
  family?: string;
}

export interface V3RoutingConfig {
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
const ATTEMPT = `${ASSIGNMENT}/attempts/${ID}`;

const exact = (method: string, path: string): RouteMatcher => ({
  method,
  pattern: new RegExp(`^${path}$`),
});

export interface RouteFamily {
  roles: ReadonlySet<UserRole>;
  matchers: readonly RouteMatcher[];
}

const LEARNER_ONLY: ReadonlySet<UserRole> = new Set([UserRole.LEARNER]);

export const ROUTE_FAMILIES: ReadonlyMap<string, RouteFamily> = new Map([
  [
    "session-meta",
    {
      roles: new Set([UserRole.LEARNER, UserRole.AUTHOR]),
      matchers: [
        exact("GET", "/api/v1/user-session"),
        exact("GET", "/api/v1/ai-status"),
      ],
    },
  ],
  [
    "learner-reads",
    {
      roles: LEARNER_ONLY,
      matchers: [
        exact("GET", ASSIGNMENT),
        exact("GET", `${ASSIGNMENT}/languages`),
        exact("GET", `${ASSIGNMENT}/attempts`),
        exact("GET", `${ASSIGNMENT}/attempts/${ID}`),
      ],
    },
  ],
  [
    "learner-attempt-writes",
    {
      roles: LEARNER_ONLY,
      matchers: [
        exact("POST", `${ASSIGNMENT}/attempts`),
        exact("POST", `${ASSIGNMENT}/attempts/${ID}/abandon`),
      ],
    },
  ],
  [
    "learner-submit",
    {
      roles: LEARNER_ONLY,
      matchers: [
        exact("PATCH", ATTEMPT),
        exact("GET", `${ATTEMPT}/completed`),
        exact("GET", `${ATTEMPT}/submission-status`),
        exact("POST", `${ATTEMPT}/notify`),
        exact("GET", `${ATTEMPT}/grade-sync-status`),
        exact("GET", `${ATTEMPT}/grading/${ID}/status-stream`),
      ],
    },
  ],
]);

const LEGACY: DownstreamDecision = { service: "legacy" };

export function parseV3RoutingConfig(
  environment: NodeJS.ProcessEnv,
  logger: Pick<Logger, "warn" | "error" | "info">,
): V3RoutingConfig {
  // Trailing slashes would double up with originalUrl's leading slash.
  const endpoint =
    environment.MARK_V3_API_ENDPOINT?.trim().replace(/\/+$/, "") || undefined;
  const requested = (environment.MARK_V3_ROUTES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const families = new Set<string>();
  for (const name of requested) {
    if (ROUTE_FAMILIES.has(name)) {
      families.add(name);
    } else {
      logger.warn("Ignoring unknown v3 route family", { family: name });
    }
  }

  if (families.size > 0 && !endpoint) {
    // Misconfiguration must never fail learner requests; fall back to legacy.
    logger.error(
      "MARK_V3_ROUTES is set but MARK_V3_API_ENDPOINT is not; routing everything to the legacy API",
      { families: [...families] },
    );
    return { endpoint: undefined, families: new Set() };
  }

  if (families.size > 0) {
    logger.info("V3 API routing enabled", { families: [...families] });
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
    const matchers = ROUTE_FAMILIES.get(family)?.matchers ?? [];
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
  config: V3RoutingConfig,
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
  const allowed = ROUTE_FAMILIES.get(family)?.roles;
  if (role === undefined || !allowed?.has(role)) {
    return { service: "legacy", family };
  }
  return { service: "v3", family };
}
