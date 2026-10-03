/**
 * Portal identity for the current session.
 *
 * Mark is launched over LTI from a host site — a Skills Network portal
 * (cognitiveclass.ai, blitzacademy.skillsnetwork.site, ...) or a content
 * platform (Coursera, edX). Prefer the return URL when it is usable. Otherwise,
 * use the outcome service URL carried on graded launches, since some LMSs
 * omit the return URL. A callback endpoint contributes only its host, never
 * a link displayed to a learner.
 *
 * This module is the single place Mark decides what "the portal" is. If the
 * lti-gateway later adds a portal claim, this is the only file that changes.
 */

export interface PortalContext {
  /** Hostname of the launching site, lowercased, without a leading "www.". */
  portalHost?: string;
  /**
   * Display name. Known content platforms get their product-facing label;
   * everything else falls back to the hostname, because only portal-manager
   * knows a portal's real display name (a hostname suffix does not imply it:
   * courses.lpu.cognitiveclass.ai is an India-academic portal, not Cognitive
   * Class).
   */
  portalName?: string;
  /** Origin of the launching site, e.g. "https://www.coursera.org". */
  portalUrl?: string;
}

/**
 * LTI platforms that are not portals, so portal-manager cannot name them.
 * Matched on the hostname or any subdomain of it.
 */
const PLATFORM_LABEL_BY_HOST_SUFFIX: Record<string, string> = {
  "coursera.org": "Coursera",
  "edx.org": "edX",
  "author.skills.network": "Faculty",
};

// SN Support caps reporterOrigin at 200 chars and custom metadata values at
// 500; drop rather than send something that would be rejected downstream.
const PORTAL_NAME_MAX_CHARS = 200;
const PORTAL_URL_MAX_CHARS = 500;

export function platformLabelForHost(host: string): string | undefined {
  for (const [suffix, label] of Object.entries(PLATFORM_LABEL_BY_HOST_SUFFIX)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return label;
  }
  return undefined;
}

/**
 * Portal identity derived from the LTI return URL or outcome service URL.
 * Returns an empty context when neither is a usable HTTP(S) URL. Never throws:
 * malformed claims must not prevent a report from being submitted.
 */
export function derivePortalContext(
  session?: { returnUrl?: unknown; lisOutcomeServiceUrl?: unknown } | null,
): PortalContext {
  const fromReturnUrl = parseHttpUrl(session?.returnUrl);
  // Only the host is taken from the callback endpoint; portalUrl stays unset
  // rather than pointing a human at a grade-posting API.
  const url = fromReturnUrl ?? parseHttpUrl(session?.lisOutcomeServiceUrl);
  if (!url) return {};

  const portalHost = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!portalHost) return {};

  const portalName = platformLabelForHost(portalHost) ?? portalHost;
  const portalUrl = fromReturnUrl ? url.origin : undefined;

  return {
    portalHost,
    portalName:
      portalName.length <= PORTAL_NAME_MAX_CHARS ? portalName : undefined,
    portalUrl:
      portalUrl && portalUrl.length <= PORTAL_URL_MAX_CHARS
        ? portalUrl
        : undefined,
  };
}

/** LMS host of the session's outcome service URL. Never throws. */
export function deriveLmsHost(
  session?: { lisOutcomeServiceUrl?: unknown } | null,
): string | undefined {
  const url = parseHttpUrl(session?.lisOutcomeServiceUrl);
  return url?.hostname.toLowerCase().replace(/^www\./, "");
}

function parseHttpUrl(value?: unknown): URL | undefined {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return;
  }
}
