import {
  AssignmentAttempt,
  AssignmentAttemptWithQuestions,
} from "@/config/types";

type MaybeDateValue =
  | string
  | Date
  | number
  | null
  | undefined
  | Record<string, unknown>;

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
  const isoString = toIsoString(expiresAt);
  if (!isoString) {
    return undefined;
  }

  const timestamp = new Date(isoString).getTime();
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

    const attemptCreatedAt = getTimestampMs(attempt.createdAt);
    const latestCreatedAt = getTimestampMs(latest.createdAt);

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

export const toIsoString = (value: MaybeDateValue): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    typeof value === "object" &&
    "toISOString" in value &&
    typeof (value as { toISOString: () => string }).toISOString === "function"
  ) {
    try {
      return (value as { toISOString: () => string }).toISOString();
    } catch {
      return undefined;
    }
  }

  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  return undefined;
};

export const getTimestampMs = (value: MaybeDateValue): number => {
  const isoString = toIsoString(value);
  if (!isoString) {
    return Number.NaN;
  }

  return new Date(isoString).getTime();
};

export type AttemptWithTiming =
  | AssignmentAttempt
  | AssignmentAttemptWithQuestions
  | (AssignmentAttempt & { [key: string]: unknown });

export const normalizeAttemptTimestamps = <T extends AttemptWithTiming>(
  attempt: T,
  fallbackAllotedMinutes?: number | string | null,
): T => {
  const parsedFallbackMinutes =
    typeof fallbackAllotedMinutes === "string"
      ? Number(fallbackAllotedMinutes)
      : fallbackAllotedMinutes;

  const createdAtIso = toIsoString(attempt.createdAt) ?? undefined;
  const expiresAtIso = toIsoString(attempt.expiresAt);
  const updatedAtIso =
    toIsoString((attempt as AssignmentAttempt)?.updatedAt) ?? undefined;

  let normalizedExpiresAt = expiresAtIso;
  if (
    !normalizedExpiresAt &&
    !isAttemptSubmitted(attempt as AssignmentAttempt) &&
    createdAtIso &&
    parsedFallbackMinutes &&
    parsedFallbackMinutes > 0
  ) {
    const createdAtMs = new Date(createdAtIso).getTime();
    if (!Number.isNaN(createdAtMs)) {
      normalizedExpiresAt = new Date(
        createdAtMs + parsedFallbackMinutes * 60_000,
      ).toISOString();
    }
  }

  // If the attempt is already submitted and we still don't have a reliable
  // expiresAt, fall back to the last update time which reflects completion.
  if (
    isAttemptSubmitted(attempt as AssignmentAttempt) &&
    !normalizedExpiresAt &&
    updatedAtIso
  ) {
    normalizedExpiresAt = updatedAtIso;
  }

  if (
    isAttemptSubmitted(attempt as AssignmentAttempt) &&
    normalizedExpiresAt &&
    updatedAtIso
  ) {
    const normalizedMs = new Date(normalizedExpiresAt).getTime();
    const updatedMs = new Date(updatedAtIso).getTime();

    if (!Number.isNaN(normalizedMs) && !Number.isNaN(updatedMs)) {
      if (updatedMs < normalizedMs) {
        normalizedExpiresAt = updatedAtIso;
      }
    }
  }

  if (
    !normalizedExpiresAt &&
    createdAtIso &&
    isAttemptSubmitted(attempt as AssignmentAttempt)
  ) {
    normalizedExpiresAt = createdAtIso;
  }

  return {
    ...attempt,
    createdAt: createdAtIso ?? attempt.createdAt,
    updatedAt: updatedAtIso ?? attempt.updatedAt,
    expiresAt: normalizedExpiresAt ?? null,
  } as T;
};
