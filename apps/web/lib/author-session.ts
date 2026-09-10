// Per-tab identity of the mounted editor. It survives temporary session loss.
let editor: { assignmentId: number; userId: string } | undefined;

export function bindAuthorSession(assignmentId: number, userId: string) {
  editor = { assignmentId, userId };
}

export function authorSessionHeaders(
  includeIdentity = true,
): Record<string, string> {
  if (typeof window === "undefined") return {};
  const match = window.location.pathname.match(/^\/author\/([1-9]\d*)(?:\/|$)/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return {};
  return {
    "x-mark-author-assignment": match[1],
    ...(includeIdentity && editor?.assignmentId === Number(match[1])
      ? { "x-mark-author-user": editor.userId }
      : {}),
  };
}
