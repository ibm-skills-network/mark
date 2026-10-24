"use client";

import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useUiTranslation } from "@/hooks/use-ui-translation";
import type { GradingFailure, GradingIssue } from "@/lib/grading-failure";
import {
  UNABLE_TO_GRADE_UI_STRINGS as UI,
  describeGradingIssue,
  safeHttpUrl,
  truncateMiddle,
} from "@/lib/grading-issue-copy";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";

interface UnableToGradePanelProps {
  failure: GradingFailure;
  /** Question ids in the order this attempt shows them (handles shuffling). */
  questionOrder: readonly number[];
  /** Closes the dialog and shows that question; null means "the attempt". */
  onGoToQuestion: (questionNumber: number | null) => void;
  /** Resubmits unchanged; offered when every issue is temporary. */
  onRetry?: () => void;
}

/**
 * The learner's submission couldn't be graded as submitted. Deliberately a
 * calm warning, not an error: nothing broke on our side, so there is no
 * report action here — only what to fix and a way back to fix it.
 */
export default function UnableToGradePanel({
  failure,
  questionOrder,
  onGoToQuestion,
  onRetry,
}: UnableToGradePanelProps) {
  const { t, activeLanguage } = useUiTranslation();
  const isEnglish = activeLanguage === DEFAULT_UI_LANGUAGE;

  const numberOf = (questionId: number): number | null => {
    const index = questionOrder.indexOf(questionId);
    return index === -1 ? null : index + 1;
  };

  const issues = [...failure.issues].sort((a, b) => {
    const left = numberOf(a.questionId) ?? Number.MAX_SAFE_INTEGER;
    const right = numberOf(b.questionId) ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
  const allRetryable = issues.every((issue) => issue.retryable);
  const firstToFix = issues.find((issue) => !issue.retryable);

  return (
    <div
      className="text-left"
      role="alert"
      data-testid="unable-to-grade"
      data-no-ui-translate="true"
    >
      <div className="flex flex-col items-center text-center mb-5">
        <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center mb-4">
          <ExclamationTriangleIcon
            className="w-9 h-9 text-amber-700 dark:text-amber-300"
            aria-hidden="true"
          />
        </div>
        <h3
          translate="no"
          className="text-2xl font-bold mb-2 text-amber-950 dark:text-amber-50"
        >
          {t(UI.title)}
        </h3>
        <p
          translate="no"
          className="text-sm text-amber-900 dark:text-amber-100"
        >
          {t(UI.subtitle)}
        </p>
      </div>

      <ul className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {issues.map((issue, index) => (
          <IssueRow
            key={`${issue.questionId}-${index}`}
            issue={issue}
            questionNumber={numberOf(issue.questionId)}
            message={describeGradingIssue(issue, t, { isEnglish })}
            onGoToQuestion={onGoToQuestion}
            onRetry={onRetry}
          />
        ))}
      </ul>

      <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-end">
        {allRetryable && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            translate="no"
            className="inline-flex items-center justify-center rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
          >
            {t(UI.tryAgain)}
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              onGoToQuestion(
                firstToFix ? numberOf(firstToFix.questionId) : null,
              )
            }
            translate="no"
            className="inline-flex items-center justify-center rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
          >
            {t(UI.goToAnswers)}
          </button>
        )}
      </div>
    </div>
  );
}

function IssueRow({
  issue,
  questionNumber,
  message,
  onGoToQuestion,
  onRetry,
}: {
  issue: GradingIssue;
  questionNumber: number | null;
  message: string;
  onGoToQuestion: (questionNumber: number | null) => void;
  onRetry?: () => void;
}) {
  const { t } = useUiTranslation();
  const source = issue.source;
  const sourceValue = source?.url ?? source?.fileName;
  const isLink = source?.url !== undefined;
  const href = isLink ? safeHttpUrl(source?.url) : undefined;

  return (
    <li
      className="rounded-xl border border-amber-300 dark:border-amber-700 bg-white/70 dark:bg-gray-900/40 px-4 py-3 text-sm text-gray-900 dark:text-gray-100"
      data-testid="unable-to-grade-issue"
    >
      <p
        translate="no"
        className="font-semibold text-amber-950 dark:text-amber-100 mb-1"
      >
        {questionNumber === null
          ? t(UI.unknownQuestionLabel)
          : t(UI.questionLabel, { number: questionNumber })}
      </p>
      <p translate="no" className="leading-relaxed">
        {message}
      </p>
      {sourceValue && (
        <p className="mt-2 text-xs text-gray-700 dark:text-gray-300 break-all">
          <span translate="no" className="font-medium mr-1">
            {t(isLink ? UI.yourLink : UI.yourFile)}
          </span>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={sourceValue}
              className="underline text-amber-900 dark:text-amber-200 hover:text-amber-950 dark:hover:text-amber-50"
            >
              {truncateMiddle(sourceValue, 80)}
            </a>
          ) : (
            <span title={sourceValue}>{truncateMiddle(sourceValue, 80)}</span>
          )}
        </p>
      )}
      {issue.retryable && (
        <p
          translate="no"
          className="mt-2 text-xs text-amber-900 dark:text-amber-200"
        >
          {t(UI.retryHint)}
        </p>
      )}
      <div className="mt-3">
        {issue.retryable && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            translate="no"
            className="text-sm font-semibold text-amber-900 dark:text-amber-200 underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 rounded"
          >
            {t(UI.tryAgain)}
          </button>
        ) : questionNumber !== null ? (
          <button
            type="button"
            onClick={() => onGoToQuestion(questionNumber)}
            translate="no"
            className="text-sm font-semibold text-amber-900 dark:text-amber-200 underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 rounded"
          >
            {t(UI.goToQuestion, { number: questionNumber })}
          </button>
        ) : null}
      </div>
    </li>
  );
}
