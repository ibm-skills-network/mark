/**
 * Recognises learner links that can never be graded as submitted, before any
 * network call: an address that still has the instructions' placeholder in
 * it, or a GitHub page that isn't content (a project board, an issue list, an
 * editor). Also recognises the course's own starter repositories so a failed
 * fetch of one can tell the learner to submit their copy instead.
 */

export type PrefetchUrlIssueCode = "url_placeholder" | "url_unsupported";

export interface PrefetchUrlIssue {
  code: PrefetchUrlIssueCode;
  /** Short operator-facing label for logs, e.g. the placeholder token. */
  detail: string;
}

/** GitHub orgs that publish the course starter repositories learners fork. */
export const COURSE_TEMPLATE_GITHUB_ORGS: readonly string[] = [
  "ibm-developer-skills-network",
];

// Whole path segments that only ever come from copied instructions.
const PLACEHOLDER_SEGMENT_RE = new RegExp(
  [
    // your-username, YOUR_GITHUB_USERNAME, yourusername, your-repo-name, your-repository ...
    String.raw`(?:your|votre|tu|seu)[-_]?(?:github[-_]?)?(?:user(?:[-_]?name)?|name|handle|account|login|id|repo(?:sitory)?(?:[-_]?name)?|project(?:[-_]?name)?)`,
    "johndoe",
    "john[-_]doe",
    "janedoe",
    "jane[-_]doe",
    "user[-_]?name",
    "github[-_]?user(?:[-_]?name)?",
    "repo[-_]?name",
  ]
    .map((pattern) => `^(?:${pattern})$`)
    .join("|"),
  "i",
);

const PLACEHOLDER_HOSTS = new Set([
  "example.com",
  "www.example.com",
  "example.org",
  "example.net",
]);

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

function safeParse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    // Unparseable input is reported by the URL validation step, not here.
    return undefined;
  }
}

function decodedSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        // A stray "%" is just part of the text the learner typed.
        return segment;
      }
    });
}

function findPlaceholder(parsed: URL): string | undefined {
  if (PLACEHOLDER_HOSTS.has(parsed.hostname.toLowerCase())) {
    return parsed.hostname;
  }
  const segments = decodedSegments(parsed.pathname);
  // Owner and repository (or the first two path segments on other hosts) are
  // where instructions put their placeholders; deeper segments are file paths
  // the learner chose, where "username" can be a real file name.
  for (const segment of segments.slice(0, 2)) {
    if (segment.includes("<") || segment.includes(">")) return segment;
    if (PLACEHOLDER_SEGMENT_RE.test(segment)) return segment;
  }
  return undefined;
}

// github.com/<owner>/<repo>/<view> pages with no gradeable content.
const UNSUPPORTED_REPO_VIEWS = new Set([
  "new",
  "issues",
  "pulls",
  "compare",
  "projects",
]);

function findUnsupportedGithubPage(parsed: URL): string | undefined {
  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return undefined;
  const segments = decodedSegments(parsed.pathname);
  const [first, , third] = segments;
  if (
    (first === "orgs" || first === "users") &&
    segments.includes("projects")
  ) {
    return `${first}/projects`;
  }
  if (third === undefined) return undefined;
  const view = third.toLowerCase();
  if (!UNSUPPORTED_REPO_VIEWS.has(view)) return undefined;
  // A single issue or pull request (…/issues/12) has content; the list does not.
  if (
    (view === "issues" || view === "pulls") &&
    segments.length > 3 &&
    /^\d+$/.test(segments[3])
  ) {
    return undefined;
  }
  return view;
}

/** Pre-fetch check: a link that cannot be graded however many times it is fetched. */
export function detectPrefetchUrlIssue(
  url: string,
): PrefetchUrlIssue | undefined {
  const parsed = safeParse(url);
  if (!parsed) return undefined;
  const placeholder = findPlaceholder(parsed);
  if (placeholder) return { code: "url_placeholder", detail: placeholder };
  const unsupported = findUnsupportedGithubPage(parsed);
  if (unsupported) return { code: "url_unsupported", detail: unsupported };
  return undefined;
}

/** True when the link points into one of the course's own starter repositories. */
export function isCourseTemplateRepoUrl(url: string): boolean {
  const parsed = safeParse(url);
  if (!parsed || !GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) {
    return false;
  }
  const [owner] = decodedSegments(parsed.pathname);
  return (
    owner !== undefined &&
    COURSE_TEMPLATE_GITHUB_ORGS.includes(owner.toLowerCase())
  );
}
