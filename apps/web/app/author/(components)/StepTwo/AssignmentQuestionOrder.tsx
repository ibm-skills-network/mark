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
import SectionWithTitle from "../ReusableSections/SectionWithTitle";

type Props = ComponentPropsWithoutRef<"div">;

const Component: FC<Props> = () => {
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

  const totalQuestions = useAuthorStore((s) => s.questions).length;

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
    >
      <button type="button" value="DEFINED" onClick={handleDefinedOrRandom}>
        <div className="flex items-center gap-x-1.5 cursor-pointer">
          <RadioDot active={displayOrder === "DEFINED"} />
          <p
            className={cn(
              "leading-5 transition-all",
              displayOrder === "DEFINED"
                ? "font-bold text-violet-600"
                : "font-medium",
            )}
          >
            Strict Order
          </p>
        </div>
        <p className="text-gray-500 text-left">
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
                ? "font-bold text-violet-600"
                : "font-medium",
            )}
          >
            Random Order
          </p>
        </div>
        <p className="text-gray-500 text-left">
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
                ? "font-bold text-violet-600"
                : "font-medium",
            )}
          >
            Random Subset:
          </p>
          <input
            type="number"
            className="border focus:border-violet-600 focus:ring-0 border-gray-200 w-52 rounded-md h-10 focus:outline-none"
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
        <p className="text-gray-500 text-left">
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

      {errors.displayOrder && (
        <p className="text-red-500 text-sm">{errors.displayOrder}</p>
      )}
    </SectionWithTitle>
  );
};

const RadioDot: FC<{ active: boolean }> = ({ active }) => (
  <div className="flex items-center justify-center w-4 h-4 bg-white border border-gray-400 rounded-full">
    <div
      className={cn("w-2.5 h-2.5 rounded-full", active && "bg-violet-600")}
    />
  </div>
);

const Popup: FC<{ message: string }> = ({ message }) => (
  <div className="absolute top-full left-0 mt-2 z-10 bg-orange-50 border border-orange-200 rounded-md shadow-lg p-3 max-w-sm">
    <div className="flex items-start space-x-2">
      <div className="w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center mt-0.5">
        <span className="text-white text-xs">!</span>
      </div>
      <span className="text-orange-700 text-sm">{message}</span>
    </div>
    <div className="absolute -top-1 left-4 w-2 h-2 bg-orange-50 border-l border-t border-orange-200 transform rotate-45" />
  </div>
);

export default Component;
