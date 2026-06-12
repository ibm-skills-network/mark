import { extractAssignmentId } from "@/lib/strings";
import { createSafeStorage, type SafeStorage } from "@/lib/safe-storage";

type AssignmentStoreScope = "author" | "config" | "feedbackConfig";

function getAssignmentStoreName(pathname: string, scope: AssignmentStoreScope) {
  const assignmentId = extractAssignmentId(pathname);
  if (!assignmentId) return null;

  if (scope === "author") {
    return `assignment-${assignmentId}-author`;
  }

  if (scope === "config") {
    return `assignment-${assignmentId}-config`;
  }

  return `assignmentFeedbackConfig-${assignmentId}`;
}

export function createAssignmentScopedStorage(
  scope: AssignmentStoreScope,
  fallbackName: string,
): SafeStorage {
  const storage = createSafeStorage();
  const resolveName = (name: string) => {
    if (typeof window === "undefined") {
      return name;
    }

    return (
      getAssignmentStoreName(window.location.pathname, scope) ?? fallbackName
    );
  };

  return {
    getItem: (name) => storage.getItem(resolveName(name)),
    setItem: (name, value) => storage.setItem(resolveName(name), value),
    removeItem: (name) => storage.removeItem(resolveName(name)),
  };
}
