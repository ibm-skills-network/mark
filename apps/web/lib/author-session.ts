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
