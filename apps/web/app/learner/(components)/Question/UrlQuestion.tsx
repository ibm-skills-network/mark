import { QuestionStore } from "@/config/types";
import { cn } from "@/lib/strings";
import {
  describeLearnerUrlProblem,
  expectedHostsForResponseType,
  normalizeLearnerUrl,
  validateLearnerUrl,
} from "@/lib/url-response";
import { useLearnerStore } from "@/stores/learner";
import { type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  question: QuestionStore;
  onUrlChange: (url: string, questionId: number) => void;
}

function URLQuestion(props: Props) {
  const { className, question, onUrlChange } = props;
  const [setURLResponse] = useLearnerStore((state) => [
    state.setURLResponse,
    state.activeAttemptId,
  ]);
  const { id, learnerUrlResponse: url } = question;

  // Derived, not state: a separate `validURL` flag drifted out of sync with
  // the stored answer whenever the value changed from anywhere but this input.
  const validation = validateLearnerUrl(url, {
    expectedHosts: expectedHostsForResponseType(question.responseType),
  });
  const message = url?.trim()
    ? describeLearnerUrlProblem(validation)
    : undefined;
  const isBlocking = Boolean(url?.trim()) && !validation.isValid;

  const handleURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setURLResponse(newUrl, id);
    onUrlChange(newUrl, id);
  };

  /**
   * Tidy the value once the learner is done typing rather than on every
   * keystroke — normalizing mid-word would fight them by inserting a scheme
   * in front of a half-typed host.
   */
  const handleBlur = () => {
    const normalized = normalizeLearnerUrl(url);
    if (normalized && normalized !== url) {
      setURLResponse(normalized, id);
      onUrlChange(normalized, id);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        className={cn(
          "w-full p-2 border rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100",
          isBlocking
            ? "border-red-500"
            : "border-gray-300 dark:border-gray-600",
          className,
        )}
        value={url}
        placeholder="Enter website URL"
        onChange={handleURLChange}
        onBlur={handleBlur}
        aria-invalid={isBlocking}
        aria-describedby={message ? `url-question-${id}-message` : undefined}
      />

      {message && (
        // In-flow and always visible: this used to be an absolutely
        // positioned overlay that could sit off-screen on a narrow viewport,
        // and the matching submit-button reason only appeared on hover — so a
        // learner on a phone saw a dead Submit button and no explanation.
        <div
          id={`url-question-${id}-message`}
          role={isBlocking ? "alert" : "status"}
          className={cn(
            "mt-2 flex items-start gap-2 rounded-md border p-3 text-sm",
            isBlocking
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs text-white",
              isBlocking ? "bg-red-500" : "bg-amber-500",
            )}
          >
            !
          </span>
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}

export default URLQuestion;
