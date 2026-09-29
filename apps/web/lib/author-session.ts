// Per-tab identity of the mounted editor. It survives temporary session loss.
let editor: { assignmentId: number; userId: string } | undefined;

export function bindAuthorSession(assignmentId: number, userId: string) {
  editor = { assignmentId, userId };
}

export function authorSessionHeaders(
  includeIdentity = true,
): Record<string, string> {
  if (typeof window === "undefined") return {};
  const match = window.location.pathname.match(
    /^\/(author|learner)\/([1-9]\d*)(?:\/|$)/,
  );
  if (!match || !Number.isSafeInteger(Number(match[2]))) return {};
  const role =
    match[1] === "author" ||
    new URLSearchParams(window.location.search).get("authorMode") === "true"
      ? "author"
      : "learner";
  return {
    [`x-mark-${role}-assignment`]: match[2],
    ...(includeIdentity &&
    role === "author" &&
    editor?.assignmentId === Number(match[2])
      ? { "x-mark-author-user": editor.userId }
      : {}),
  };
}

/**
 * Results path for an attempt. An author preview must stay marked as one:
 * the gateway picks the session by this context, so a results page without
 * `authorMode` asks for a learner session the author never had.
 */
export function learnerSuccessPath(
  assignmentId: number | string,
  attemptId: number | string,
): string {
  const path = `/learner/${assignmentId}/successPage/${attemptId}`;
  const isAuthorPreview =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("authorMode") === "true";
  return isAuthorPreview ? `${path}?authorMode=true` : path;
}
