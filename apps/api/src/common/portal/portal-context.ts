/**
 * Portal identity for the current session.
 *
 * Mark is launched over LTI from a host site — a Skills Network portal
 * (cognitiveclass.ai, blitzacademy.skillsnetwork.site, ...) or a content
 * platform (Coursera, edX). The launch JWT does not carry the portal, so the
 * only identity available is the `returnUrl` claim (LTI
 * `launch_presentation_return_url`, the "Return to Course" link).
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

function platformLabelForHost(host: string): string | undefined {
  for (const [suffix, label] of Object.entries(PLATFORM_LABEL_BY_HOST_SUFFIX)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return label;
  }
  return undefined;
}

/**
 * Portal identity derived from the session's LTI return URL. Returns an empty
 * context for sessions that have none (admin and bearer-token sessions) or a
 * value that is not an http(s) URL. Never throws — this runs on request paths
 * where a bad claim must not fail the request.
 */
export function derivePortalContext(
  session?: { returnUrl?: string } | null,
): PortalContext {
  const returnUrl = session?.returnUrl?.trim();
  if (!returnUrl) return {};

  let url: URL;
  try {
    url = new URL(returnUrl);
  } catch {
    return {};
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return {};

  const portalHost = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!portalHost) return {};

  const portalName = platformLabelForHost(portalHost) ?? portalHost;
  const portalUrl = url.origin;

  return {
    portalHost,
    portalName:
      portalName.length <= PORTAL_NAME_MAX_CHARS ? portalName : undefined,
    portalUrl: portalUrl.length <= PORTAL_URL_MAX_CHARS ? portalUrl : undefined,
  };
}
