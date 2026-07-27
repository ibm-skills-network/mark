"use client";

import { stepTwoSections } from "@/config/constants";
import { cn } from "@/lib/strings";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import {
  type ComponentPropsWithoutRef,
  type FC,
  type MouseEvent,
  useState,
  useEffect,
} from "react";
import { SectionWithTitle } from "../ReusableSections/SectionWithTitle";
import { describeQuestionsPerAttemptClamp } from "@/app/Helpers/questionsPerAttemptClamp";

type Props = ComponentPropsWithoutRef<"div"> & { compact?: boolean };

const Component: FC<Props> = ({ compact }) => {
  const [displayOrder, setDisplayOrder, errors] = useAssignmentConfig((s) => [
    s.displayOrder,
    s.setDisplayOrder,
    s.errors,
  ]);
  const { numberOfQuestionsPerAttempt, setNumberOfQuestionsPerAttempt } =
    useAssignmentConfig();

  const [selectedRandomQuestions, setSelectedRandomQuestions] = useState(false);

  function handleDefinedOrRandom(e: MouseEvent<HTMLButtonElement>): void {
    const value = e.currentTarget.value;
    setDisplayOrder(value as "DEFINED" | "RANDOM");
    setSelectedRandomQuestions(false);
    setNumberOfQuestionsPerAttempt(null);
  }

  function handleRandomizeQuestions(): void {
    setDisplayOrder("RANDOM");
    setSelectedRandomQuestions(true);
  }

  const totalQuestions = useAuthorStore(
    (s) => s.questions.filter((question) => !question.isDeleted).length,
  );

  // The input below refuses a count larger than the pool, so this only fires
  // for assignments that already carry one: authored before that cap existed,
  // or had questions deleted afterwards. Publishing corrects it server-side
  // rather than failing, so this is a heads-up, not an error.
  const clampNotice = describeQuestionsPerAttemptClamp(
    numberOfQuestionsPerAttempt,
    totalQuestions,
  );

  const [popupMessage, setPopupMessage] = useState("");
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    if (!showPopup) return;
    const t = setTimeout(() => {
      setShowPopup(false);
      setPopupMessage("");
    }, 3_000);
    return () => clearTimeout(t);
  }, [showPopup]);

  function showValidationPopup(msg: string) {
    setPopupMessage(msg);
    setShowPopup(true);
  }
  useEffect(() => {
    if (numberOfQuestionsPerAttempt !== null) {
      setSelectedRandomQuestions(true);
    } else {
      setSelectedRandomQuestions(false);
    }
  }, [numberOfQuestionsPerAttempt]);

  return (
    <SectionWithTitle
      title={stepTwoSections.order.title}
      className="flex flex-col gap-y-6"
      required
      compact={compact}
    >
      <button type="button" value="DEFINED" onClick={handleDefinedOrRandom}>
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <RadioDot active={displayOrder === "DEFINED"} />
          <p
            className={cn(
              "leading-5 transition-all",
              displayOrder === "DEFINED"
                ? "font-bold text-violet-600 dark:text-violet-300"
                : "font-medium",
            )}
          >
            Strict Order
          </p>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-left">
          Questions always appear in the order you set.
        </p>
      </button>

      <button type="button" value="RANDOM" onClick={handleDefinedOrRandom}>
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <RadioDot
            active={displayOrder === "RANDOM" && !selectedRandomQuestions}
          />

          <p
            className={cn(
              "leading-5 transition-all",
              displayOrder === "RANDOM" && !selectedRandomQuestions
                ? "font-bold text-violet-600 dark:text-violet-300"
                : "font-medium",
            )}
          >
            Random Order
          </p>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-left">
          All questions are shuffled for each assignment attempt.
        </p>
      </button>

      <button type="button" onClick={handleRandomizeQuestions}>
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <RadioDot active={selectedRandomQuestions} />
          <p
            className={cn(
              "leading-5 transition-all",
              selectedRandomQuestions
                ? "font-bold text-violet-600 dark:text-violet-300"
                : "font-medium",
            )}
          >
            Random Subset:
          </p>
          <input
            type="number"
            className="border focus:border-violet-600 focus:ring-0 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 w-52 rounded-md h-10 focus:outline-none"
            placeholder="Number per attempt"
            min={0}
            max={totalQuestions || undefined}
            step={1}
            value={
              selectedRandomQuestions && numberOfQuestionsPerAttempt
                ? numberOfQuestionsPerAttempt
                : ""
            }
            onChange={(e) => {
              const raw = e.target.value;

              if (!raw) {
                setNumberOfQuestionsPerAttempt(null);
                return;
              }

              const value = parseInt(raw, 10);
              if (Number.isNaN(value) || value <= 0) {
                showValidationPopup("Enter a positive number.");
                return;
              }
              if (value > totalQuestions) {
                showValidationPopup(
                  `Only ${totalQuestions} question${
                    totalQuestions === 1 ? "" : "s"
                  } exist.`,
                );
                return;
              }
              if (value === totalQuestions) {
                showValidationPopup(
                  "Same as total number of questions. Just pick Randomize all.",
                );
                return;
              }
              setNumberOfQuestionsPerAttempt(value);
            }}
          />

          {showPopup && <Popup message={popupMessage} />}
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-left">
          {numberOfQuestionsPerAttempt ? (
            <>
              For each assignment attempt learners will be given{" "}
              <b>{numberOfQuestionsPerAttempt}</b> randomly selected question(s)
              from your total set of <b>{totalQuestions}</b> questions.
            </>
          ) : (
            <>
              For each assignment attempt learners will be given a subset of
              randomly selected question(s) from your total set of{" "}
              <b>{totalQuestions}</b> questions.
            </>
          )}
        </p>
      </button>

      {clampNotice && (
        <div
          role="status"
          className="flex items-start gap-x-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3"
        >
          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500">
            <span className="text-xs text-white">!</span>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {clampNotice}
          </p>
        </div>
      )}

      {errors.displayOrder && (
        <p className="text-red-500 text-sm">{errors.displayOrder}</p>
      )}
    </SectionWithTitle>
  );
};

const RadioDot: FC<{ active: boolean }> = ({ active }) => (
  <div className="flex items-center justify-center w-4 h-4 bg-white dark:bg-gray-800 border border-gray-400 dark:border-gray-600 rounded-full">
    <div
      className={cn("w-2.5 h-2.5 rounded-full", active && "bg-violet-600")}
    />
  </div>
);

const Popup: FC<{ message: string }> = ({ message }) => (
  <div className="absolute top-full left-0 mt-2 z-10 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-md shadow-lg p-3 max-w-sm">
    <div className="flex items-start space-x-2">
      <div className="w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center mt-0.5">
        <span className="text-white text-xs">!</span>
      </div>
      <span className="text-orange-700 dark:text-orange-300 text-sm">
        {message}
      </span>
    </div>
    <div className="absolute -top-1 left-4 w-2 h-2 bg-orange-50 dark:bg-orange-900/20 border-l border-t border-orange-200 dark:border-orange-800 transform rotate-45" />
  </div>
);

export default Component;
