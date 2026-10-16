/**
 * Portal identity for the current session.
 *
 * Mark is launched over LTI from a host site — a Skills Network portal
 * (cognitiveclass.ai, blitzacademy.skillsnetwork.site, ...) or a content
 * platform (Coursera, edX). Prefer the return URL when it is usable. Otherwise,
 * use the launching platform's tool_consumer_instance_guid when it is a
 * hostname, then the outcome service URL carried on graded launches: Coursera
 * omits the return URL always and the outcome URL on some items, but always
 * sends its guid. The guid and callback contribute only a host, never a link
 * displayed to a learner.
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
  /** LMS course the assignment was launched from (LTI context_title). */
  courseTitle?: string;
  /** LMS course id (LTI context_id). */
  courseId?: string;
  /** The item in the course that launched Mark. */
  activityTitle?: string;
  /** LMS product family, e.g. "Public Your Learning". */
  lmsFamily?: string;
}

/**
 * LTI platforms that are not portals, so portal-manager cannot name them.
 * Matched on the hostname or any subdomain of it.
 */
const PLATFORM_LABEL_BY_HOST_SUFFIX: Record<string, string> = {
  "coursera.org": "Coursera",
  "edx.org": "edX",
  "author.skills.network": "Faculty",
  "learn.ibm.com": "IBM Training",
  "yl.skillsnetwork.site": "Your Learning",
};

// SN Support caps reporterOrigin at 200 chars and custom metadata values at
// 500; drop rather than send something that would be rejected downstream.
const PORTAL_NAME_MAX_CHARS = 200;
const PORTAL_URL_MAX_CHARS = 500;
const COURSE_FIELD_MAX_CHARS = 500;

// Family codes that name LMS software rather than a site, so they say nothing
// about which portal a learner used.
// Homepages for portals whose launches send no usable return URL, so support
// still gets a link. Matched on the hostname or any subdomain of it.
const PORTAL_URL_BY_HOST_SUFFIX: Record<string, string> = {
  "yl.skillsnetwork.site": "https://yl.skillsnetwork.site",
};

function portalUrlForHost(host: string): string | undefined {
  for (const [suffix, url] of Object.entries(PORTAL_URL_BY_HOST_SUFFIX)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return url;
  }
  return undefined;
}

// Family codes that identify one site, for launches that name no host.
// Your Learning sends no instance guid, and its ungraded items no
// grade-callback URL, so this is the only clue to where they came from.
const HOST_BY_LMS_FAMILY: Record<string, string> = {
  "public your learning": "yl.skillsnetwork.site",
};

const GENERIC_LMS_FAMILIES = new Set([
  "blackboard",
  "brightspace",
  "canvas",
  "d2l",
  "desire2learn",
  "ims",
  "moodle",
  "open_edx",
  "openedx",
  "sakai",
  "schoology",
]);

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
  session?: {
    returnUrl?: unknown;
    toolConsumerInstanceGuid?: unknown;
    lisOutcomeServiceUrl?: unknown;
    courseTitle?: unknown;
    courseId?: unknown;
    activityTitle?: unknown;
    toolConsumerProductFamilyCode?: unknown;
  } | null,
): PortalContext {
  const lmsFamily = boundedText(session?.toolConsumerProductFamilyCode, 200);
  // The course is worth reporting even when the launch names no site.
  const course = withoutUndefined({
    courseTitle: boundedText(session?.courseTitle, COURSE_FIELD_MAX_CHARS),
    courseId: boundedText(session?.courseId, COURSE_FIELD_MAX_CHARS),
    activityTitle: boundedText(session?.activityTitle, COURSE_FIELD_MAX_CHARS),
    lmsFamily,
  });
  // An unrecognized custom family code is the only name some launches carry;
  // it labels the ticket but never routes it.
  const familyPortalName =
    lmsFamily && !GENERIC_LMS_FAMILIES.has(lmsFamily.toLowerCase())
      ? lmsFamily
      : undefined;
  const unnamed = familyPortalName
    ? { ...course, portalName: familyPortalName }
    : course;

  const fromReturnUrl = parseHttpUrl(session?.returnUrl);
  // Only a host is taken from the guid or the callback endpoint; portalUrl
  // stays unset rather than pointing a human at a grade-posting API.
  const host =
    fromReturnUrl?.hostname ??
    parseHostname(session?.toolConsumerInstanceGuid) ??
    parseHttpUrl(session?.lisOutcomeServiceUrl)?.hostname ??
    (lmsFamily ? HOST_BY_LMS_FAMILY[lmsFamily.toLowerCase()] : undefined);
  if (!host) return unnamed;

  const portalHost = host.toLowerCase().replace(/^www\./, "");
  if (!portalHost) return unnamed;

  const portalName = platformLabelForHost(portalHost) ?? portalHost;
  const portalUrl = fromReturnUrl?.origin ?? portalUrlForHost(portalHost);

  return {
    ...course,
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

// LMSs choose their own guid format (Moodle and Coursera send a hostname,
// Canvas an opaque id); only a dotted DNS name identifies a site.
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[\da-z](?:[\da-z-]{0,61}[\da-z])?\.)+[a-z]{2,63}$/i;

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

function withoutUndefined<T extends Record<string, string | undefined>>(
  value: T,
): Partial<Record<keyof T, string>> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<Record<keyof T, string>>;
}

function parseHostname(value?: unknown): string | undefined {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  return HOSTNAME_PATTERN.test(trimmed) ? trimmed : undefined;
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
