import { AssignmentAttempt } from "@/config/types";

export const coerceSubmitted = (
  submitted: AssignmentAttempt["submitted"],
): boolean => {
  if (typeof submitted === "boolean") {
    return submitted;
  }

  if (typeof submitted === "number") {
    return submitted === 1;
  }

  if (typeof submitted === "string") {
    const normalized = submitted.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "") {
      return false;
    }
    return Boolean(normalized);
  }

  return Boolean(submitted);
};

export const getExpiresAtMs = (
  expiresAt: AssignmentAttempt["expiresAt"],
): number | undefined => {
  if (!expiresAt) {
    return undefined;
  }

  const timestamp = new Date(expiresAt).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
};

export const isAttemptSubmitted = (attempt: AssignmentAttempt): boolean =>
  coerceSubmitted(attempt.submitted);

export const isAttemptInProgress = (attempt: AssignmentAttempt): boolean => {
  if (isAttemptSubmitted(attempt)) {
    return false;
  }

  const expiryTime = getExpiresAtMs(attempt.expiresAt);
  return expiryTime === undefined || Date.now() < expiryTime;
};

export const getLatestAttempt = (
  attempts: AssignmentAttempt[],
): AssignmentAttempt | null => {
  return attempts.reduce<AssignmentAttempt | null>((latest, attempt) => {
    if (!latest) return attempt;

    const attemptCreatedAt = attempt.createdAt
      ? new Date(attempt.createdAt).getTime()
      : Number.NEGATIVE_INFINITY;
    const latestCreatedAt = latest.createdAt
      ? new Date(latest.createdAt).getTime()
      : Number.NEGATIVE_INFINITY;

    const normalizedAttemptCreatedAt = Number.isNaN(attemptCreatedAt)
      ? Number.NEGATIVE_INFINITY
      : attemptCreatedAt;
    const normalizedLatestCreatedAt = Number.isNaN(latestCreatedAt)
      ? Number.NEGATIVE_INFINITY
      : latestCreatedAt;

    if (normalizedAttemptCreatedAt > normalizedLatestCreatedAt) {
      return attempt;
    }

    if (
      normalizedAttemptCreatedAt === normalizedLatestCreatedAt &&
      attempt.id > latest.id
    ) {
      return attempt;
    }

    return latest;
  }, null);
};
