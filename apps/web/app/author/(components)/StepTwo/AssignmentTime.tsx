"use client";

import Tooltip from "@/components/Tooltip";
import { stepTwoSections } from "@/config/constants";
import type { QuestionType } from "@/config/types";
import { cn } from "@/lib/strings";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import { InformationCircleIcon } from "@heroicons/react/24/solid";
import {
  useEffect,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";
import { SectionWithTitle } from "../ReusableSections/SectionWithTitle";

type Props = ComponentPropsWithoutRef<"div">;

const Component: FC<Props> = () => {
  const [
    allotedTimeMinutes,
    setAllotedTimeMinutes,
    timeEstimateMinutes,
    setTimeEstimateMinutes,
    strictTimeLimit,
    toggleStrictTimeLimit,
    setStrictTimeLimit,
    requireAllQuestions,
    toggleRequireAllQuestions,
    setRequireAllQuestions,
    optionalQuestionIds,
    toggleOptionalQuestionId,
    errors,
  ] = useAssignmentConfig((state) => [
    state.allotedTimeMinutes,
    state.setAllotedTimeMinutes,
    state.timeEstimateMinutes,
    state.setTimeEstimateMinutes,
    state.strictTimeLimit,
    state.toggleStrictTimeLimit,
    state.setStrictTimeLimit,
    state.requireAllQuestions,
    state.toggleRequireAllQuestions,
    state.setRequireAllQuestions,
    state.optionalQuestionIds,
    state.toggleOptionalQuestionId,
    state.errors,
  ]);

  const questions = useAuthorStore((state) => state.questions);

  const questionTypeLabels: Record<QuestionType, string> = {
    TEXT: "Text",
    EMPTY: "Empty",
    SINGLE_CORRECT: "Multiple Choice",
    MULTIPLE_CORRECT: "Multiple Select",
    TRUE_FALSE: "True/False",
    URL: "URL",
    UPLOAD: "File Upload",
    CODE: "Code",
    LINK_FILE: "Link File",
  };

  // Helper function to strip HTML tags from question text
  const stripHtmlTags = (html: string): string => {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  };

  useEffect(() => {
    if (allotedTimeMinutes > 0) {
      setStrictTimeLimit(true);
    }
  }, [allotedTimeMinutes]);

  useEffect(() => {
    // Turn off requireAllQuestions when strictTimeLimit is enabled
    if (strictTimeLimit && requireAllQuestions) {
      setRequireAllQuestions(false);
    }
  }, [strictTimeLimit, requireAllQuestions, setRequireAllQuestions]);

  const handleAllotedTimeChange = (
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    const { value } = event.target;

    // case 1: empty field
    if (value === "") {
      setAllotedTimeMinutes(undefined);
      return;
    }

    // case 2: not a number
    const parsedValue = Number(value);
    if (Number.isNaN(parsedValue)) {
      return;
    }

    // valid number
    setAllotedTimeMinutes(parsedValue);
  };

  const handleRequireAllQuestionsToggle = () => {
    // Only allow toggling if strictTimeLimit is disabled
    if (strictTimeLimit) {
      return;
    }
    toggleRequireAllQuestions();
  };

  let timeLimitError;
  if (!strictTimeLimit) {
    timeLimitError = undefined;
  } else {
    timeLimitError = errors.allotedTimeMinutes;
  }

  return (
    <SectionWithTitle
      title={stepTwoSections.time.title}
      className="flex flex-col gap-y-6"
      required={stepTwoSections.time.required}
    >
      <div className="flex flex-col gap-y-4">
        <div className="flex items-center gap-6">
          <label className="flex gap-1.5 w-max">
            <p
              className={cn(
                "leading-5 transition-all cursor-pointer justify-center self-center after:content-['*'] after:text-transparent",
                strictTimeLimit && "after:text-violet-600",
              )}
            >
              Enforce a strict time limit for this assignment?
            </p>
            <button
              type="button"
              onClick={toggleStrictTimeLimit}
              className={cn(
                "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                strictTimeLimit ? "bg-violet-600" : "bg-gray-200",
              )}
              role="switch"
              aria-checked={strictTimeLimit}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  strictTimeLimit ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </label>

          <label className="flex gap-1.5 w-max items-center">
            <p
              className={cn(
                "leading-5 transition-all cursor-pointer justify-center self-center",
                strictTimeLimit ? "text-gray-500" : "text-gray-700",
              )}
            >
              Enforce Required Questions
            </p>
            <button
              type="button"
              onClick={handleRequireAllQuestionsToggle}
              disabled={strictTimeLimit}
              className={cn(
                "relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                requireAllQuestions ? "bg-violet-600" : "bg-gray-200",
                strictTimeLimit && "opacity-50 cursor-not-allowed",
              )}
              role="switch"
              aria-checked={requireAllQuestions}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  requireAllQuestions ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
            <Tooltip
              content={
                strictTimeLimit
                  ? "This option is only available when strict time limit is disabled"
                  : "Require learners to complete all required questions before submission"
              }
            >
              <InformationCircleIcon
                className={cn(
                  "w-5 inline-block",
                  strictTimeLimit ? "text-gray-400" : "text-gray-500",
                )}
              />
            </Tooltip>
          </label>
        </div>
        {strictTimeLimit && (
          <>
            <div className="relative">
              <input
                type="number"
                className={cn(
                  "border focus:border-violet-600 focus:ring-0 border-gray-200 rounded-md h-10 pl-4 pr-12 py-2 focus:outline-none w-full",
                  timeLimitError && "border-red-500 focus:border-red-500",
                )}
                placeholder="Enter time limit in minutes"
                min={0}
                step={5}
                onChange={handleAllotedTimeChange}
                value={allotedTimeMinutes ?? ""}
                aria-invalid={Boolean(timeLimitError)}
                aria-describedby={
                  timeLimitError ? "alloted-time-minutes-error" : undefined
                }
              />

              <span className="absolute right-4 top-1/2 transform -translate-y-1/2">
                min
              </span>
            </div>
            {timeLimitError && (
              <p
                id="alloted-time-minutes-error"
                className="text-red-500 text-sm"
              >
                {timeLimitError}
              </p>
            )}
          </>
        )}
      </div>

      {!strictTimeLimit && requireAllQuestions && (
        <div className="flex flex-col gap-y-1">
          <details className="relative">
            <summary className="cursor-pointer list-none border focus:border-violet-600 focus:ring-0 border-gray-200 rounded-md h-10 px-4 py-2 flex items-center justify-between hover:border-gray-300 transition-colors">
              <span className="text-sm text-black-600">
                Select Required Questions
              </span>
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </summary>
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
              <div className="p-2 flex flex-col gap-1">
                {questions.length === 0 ? (
                  <p className="text-xs text-gray-500 px-2 py-1">
                    No questions added yet.
                  </p>
                ) : (
                  questions.map((question, index) => {
                    const isOptional = (optionalQuestionIds ?? []).includes(
                      question.id,
                    );
                    const questionText = question?.question?.trim()
                      ? stripHtmlTags(question.question).trim()
                      : `Question ${index + 1}`;
                    const typeLabel =
                      questionTypeLabels[question.type] ?? question.type;
                    return (
                      <div
                        key={question.id}
                        onClick={() => toggleOptionalQuestionId(question.id)}
                        className={cn(
                          "flex items-center gap-3 rounded px-2 py-2 cursor-pointer transition-all",
                          isOptional
                            ? "hover:bg-gray-50"
                            : "hover:bg-violet-50",
                        )}
                      >
                        <span className="text-xs font-medium text-gray-500 flex-shrink-0">
                          {index + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-sm truncate",
                              isOptional ? "text-gray-600" : "text-gray-800",
                            )}
                          >
                            {questionText}
                          </p>
                          <p className="text-xs text-gray-500">{typeLabel}</p>
                        </div>
                        {!isOptional && (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="w-2 h-2 rounded-full bg-violet-600"></span>
                            <span className="text-xs font-medium text-violet-700">
                              Required
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="border-t border-gray-200 p-2 bg-gray-50">
                <p className="text-xs text-amber-600">
                  Click on a question title to toggle.
                </p>
              </div>
            </div>
          </details>
        </div>
      )}

      {!strictTimeLimit && (
        <div className="flex flex-col gap-y-1">
          <p className=" text-gray-600">
            How long should learners expect to spend on this assignment (in
            minutes)?
          </p>
          <div className="relative">
            <input
              type="number"
              className={`border focus:border-violet-600 focus:ring-0 border-gray-200 rounded-md h-10 pl-4 pr-12 py-2 focus:outline-none w-full`}
              placeholder="Ex. 60"
              min={0}
              step={5}
              onChange={(e) => setTimeEstimateMinutes(~~e.target.value)}
              value={timeEstimateMinutes || ""}
            />

            <span className="absolute right-4 top-1/2 transform -translate-y-1/2">
              min
            </span>
          </div>
        </div>
      )}
    </SectionWithTitle>
  );
};

export default Component;
