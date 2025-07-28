import { handleJumpToQuestion } from "@/app/Helpers/handleJumpToQuestion";
import { useLearnerStore } from "@/stores/learner";
import type { QuestionStore } from "@config/types";
import { useCallback, useEffect, type ComponentPropsWithoutRef } from "react";
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

  useEffect(() => {
    handleJumpToQuestion(`indexQuestion-${String(activeQuestionNumber)}`);
  }, [activeQuestionNumber, handleJumpToQuestion]);

  /**
   * Computes the classes for each question button based on its status and whether it's active.
   */
  const getQuestionButtonClasses = useCallback(
    (question: QuestionStore, index: number) => {
      let baseClasses =
        "w-10 h-11 border rounded-md text-center cursor-pointer focus:outline-none flex flex-col items-center";

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
    <div className="p-4 border border-gray-300 rounded-lg flex flex-col gap-y-3 w-full md:max-w-[250px] bg-white shadow hover:shadow-md md:max-h-[310px]">
      {expiresAt ? (
        <Timer />
      ) : (
        <div className="text-gray-600 leading-tight">No time limit</div>
      )}

      <hr className="border-gray-300 -mx-4" />

      <h3 className="text-gray-600 leading-tight">Questions</h3>

      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(35px,1fr))] overflow-y-auto overflow-x-hidden scrollbar-hide">
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
                className="absolute top-0 right-0 w-4 h-4 bg-violet-500"
                style={{
                  clipPath: "polygon(100% 0, 0 0, 100% 100%)",
                  borderTopRightRadius: "0.25rem",
                }}
                aria-hidden="true"
              ></div>
            )}
            <div className="font-bold text-lg">{index + 1}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Overview;
