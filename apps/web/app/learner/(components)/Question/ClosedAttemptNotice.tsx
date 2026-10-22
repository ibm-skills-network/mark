"use client";

import { useUiTranslation } from "@/hooks/use-ui-translation";
import type { ClosedAttemptReason } from "@/lib/attempt-submission-status";
import { learnerSuccessPath } from "@/lib/author-session";
import { useRouter } from "next/navigation";

const HEADLINE = "This attempt is closed";
const VIEW_RESULTS = "View results";
const BACK_TO_ASSIGNMENT = "Back to assignment";

const MESSAGE_BY_REASON: Record<ClosedAttemptReason, string> = {
  time_limit: "This attempt was already closed at its time limit.",
  submitted: "This attempt has already been submitted.",
  expired: "This attempt's time limit has passed.",
};

/** Every string this notice renders, for the translation coverage test. */
export const CLOSED_ATTEMPT_SOURCE_STRINGS: readonly string[] = [
  HEADLINE,
  VIEW_RESULTS,
  BACK_TO_ASSIGNMENT,
  ...Object.values(MESSAGE_BY_REASON),
];

interface Props {
  assignmentId: number;
  attemptId: number;
  reason: ClosedAttemptReason;
}

/**
 * Shown in place of the questions when the server says the attempt the page
 * was handed no longer accepts a submit. Nothing here is editable, so a stale
 * page cannot collect answers that would only be rejected.
 */
export default function ClosedAttemptNotice({
  assignmentId,
  attemptId,
  reason,
}: Props) {
  const router = useRouter();
  const { t } = useUiTranslation();
  // An attempt past its deadline but not yet closed server-side has no
  // results page to show until the next submit closes it.
  const hasResults = reason !== "expired";

  return (
    <div
      role="alert"
      data-no-ui-translate="true"
      className="flex flex-col items-center justify-center gap-4 h-full px-4 py-10 text-center"
    >
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        {t(HEADLINE)}
      </h1>
      <p className="max-w-md text-gray-600 dark:text-gray-300">
        {t(MESSAGE_BY_REASON[reason])}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {hasResults && (
          <button
            type="button"
            className="rounded-md bg-violet-600 px-4 py-2 text-white hover:bg-violet-700"
            onClick={() =>
              router.push(learnerSuccessPath(assignmentId, attemptId))
            }
          >
            {t(VIEW_RESULTS)}
          </button>
        )}
        <button
          type="button"
          className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          onClick={() => router.push(`/learner/${assignmentId}`)}
        >
          {t(BACK_TO_ASSIGNMENT)}
        </button>
      </div>
    </div>
  );
}
