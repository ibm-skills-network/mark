import AccessRestricted from "@/components/AccessRestricted";
import ErrorPage from "@/components/ErrorPage";
import SessionExpired from "@/components/SessionExpired";

/**
 * Derive an HTTP status from an unknown thrown value so callers don't each
 * invent their own status->screen rule from non-status information.
 *
 * - `apiClient` throws `APIError` carrying the real `.status` (401/403/404/500).
 * - `getUser()` uses a raw fetch and throws `Error("Unauthorized")` for 401
 *   with no status field, so we recognise that message explicitly.
 * - Anything else (network failure, parse error, unknown) is a generic 500.
 */
export function statusFromError(error: unknown): number {
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
    const message = (error as { message?: unknown }).message;
    if (
      typeof message === "string" &&
      message.trim().toLowerCase() === "unauthorized"
    ) {
      return 401;
    }
  }
  return 500;
}

/**
 * Single source of truth for mapping an HTTP status to a learner error screen.
 * Keeping this in one place is what stops the three learner entry points
 * (page.tsx, LearnerLayout.tsx, AuthFetchToAbout.tsx) from drifting into
 * different, wrong mappings for the same status.
 *
 * - 401 -> SessionExpired (reload can re-establish the LMS session)
 * - 403 -> AccessRestricted (reload won't help; needs enrollment/instructor)
 * - everything else -> ErrorPage with the real status
 */
export function ErrorScreen({
  status,
  message,
}: {
  status: number;
  message?: string;
}) {
  if (status === 401) {
    return <SessionExpired />;
  }
  if (status === 403) {
    return <AccessRestricted />;
  }
  return (
    <ErrorPage error={message || "Unexpected error"} statusCode={status} />
  );
}
