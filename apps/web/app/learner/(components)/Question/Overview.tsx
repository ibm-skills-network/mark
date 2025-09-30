import { handleJumpToQuestion } from "@/app/Helpers/handleJumpToQuestion";
import { useLearnerStore } from "@/stores/learner";
import type { QuestionStore } from "@config/types";
import { TagIcon } from "@heroicons/react/20/solid";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import Timer from "./Timer";

interface Props extends ComponentPropsWithoutRef<"div"> {
  questions: QuestionStore[];
}

function Overview({ questions }: Props) {
  const [activeQuestionNumber, setActiveQuestionNumber, expiresAt] =
    useLearnerStore((state) => [
      state.activeQuestionNumber,
      state.setActiveQuestionNumber,
      state.expiresAt,
    ]);

  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    handleJumpToQuestion(`indexQuestion-${String(activeQuestionNumber)}`);
  }, [activeQuestionNumber, handleJumpToQuestion]);

  /**
   * Computes the classes for each question button based on its status and whether it's active.
   */
  const getQuestionButtonClasses = useCallback(
    (question: QuestionStore, index: number) => {
      let baseClasses =
        "w-8 h-9 md:w-10 md:h-11 border rounded-md text-center cursor-pointer focus:outline-none flex flex-col items-center";

      if (index === activeQuestionNumber - 1) {
        baseClasses += " bg-gray-100 border-violet-700 text-violet-600";
      } else if (question.status === "flagged") {
        baseClasses += " bg-gray-100 border-gray-400 text-gray-500";
      } else if (question.status === "edited") {
        baseClasses += " bg-violet-100 border-gray-400 text-violet-800 ";
      } else {
        baseClasses += " bg-gray-100 border-gray-400 text-gray-500";
      }

      return baseClasses;
    },
    [activeQuestionNumber],
  );

  return (
    <div className="p-3 md:p-4 border-0 md:border md:border-gray-300 md:rounded-lg flex flex-col gap-y-3 w-full md:max-w-[250px] bg-transparent md:bg-white md:shadow md:hover:shadow-md md:max-h-[310px]">
      {expiresAt ? (
        <Timer />
      ) : (
        <div className="text-gray-600 leading-tight text-sm md:text-base">No time limit</div>
      )}

      <hr className="border-gray-300 -mx-3 md:-mx-4" />

      <div className="flex items-center justify-between">
        <h3 className="text-gray-600 leading-tight text-sm md:text-base font-medium">Questions</h3>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="md:hidden flex items-center text-gray-600 hover:text-gray-800 transition-colors"
          aria-label={isCollapsed ? "Expand questions" : "Collapse questions"}
        >
          {isCollapsed ? (
            <ChevronDownIcon className="w-4 h-4" />
          ) : (
            <ChevronUpIcon className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className={`grid gap-2 grid-cols-[repeat(auto-fill,minmax(32px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(35px,1fr))] overflow-y-auto overflow-x-hidden scrollbar-hide transition-all duration-300 ${
        isCollapsed ? 'max-h-0 opacity-0 md:max-h-none md:opacity-100' : 'max-h-[120px] opacity-100 md:max-h-none'
      }`}>
        {questions.map((question: QuestionStore, index) => (
          <button
            key={index}
            id={`indexQuestion-${index + 1}`}
            onClick={() => {
              setActiveQuestionNumber(index + 1);
              void handleJumpToQuestion(`item-${String(index + 1)}`);
            }}
            className={`${getQuestionButtonClasses(
              question,
              index,
            )} relative flex items-center justify-center`}
          >
            {question.status === "flagged" && (
              <div
                className="absolute top-0 right-0 w-3 h-3 md:w-4 md:h-4 bg-violet-500"
                style={{
                  clipPath: "polygon(100% 0, 0 0, 100% 100%)",
                  borderTopRightRadius: "0.25rem",
                }}
                aria-hidden="true"
              ></div>
            )}
            <div className="font-bold text-sm md:text-lg">{index + 1}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Overview;
