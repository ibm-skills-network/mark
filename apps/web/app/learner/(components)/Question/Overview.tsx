import { useLearnerStore } from "@/stores/learner";
import type { QuestionStore } from "@config/types";
import {
  useCallback,
  useEffect,
  useMemo,
  type ComponentPropsWithoutRef,
} from "react";
import Timer from "./Timer";
import { IconBookmarkFilled } from "@tabler/icons-react";

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

  /**
   * Scrolls the page to the specified question element.
   *
   * @param questionId - The ID of the question element to scroll to.
   */
  const handleJumpToQuestion = useCallback((questionId: number) => {
    const element = document.getElementById(
      `indexQuestion-${String(questionId)}`,
    );

    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  useEffect(() => {
    handleJumpToQuestion(activeQuestionNumber);
  }, [activeQuestionNumber, handleJumpToQuestion]);

  /**
   * Computes the classes for each question button based on its status and whether it's active.
   */
  const getQuestionButtonClasses = useCallback(
    (question: QuestionStore, index: number) => {
      let baseClasses =
        "pb-2 w-10 h-14 border rounded-md text-center cursor-pointer focus:outline-none flex flex-col items-center";
      if (question.status === "flagged") {
        baseClasses += " bg-yellow-200 border-yellow-400 text-yellow-700";
      } else if (question.status === "edited") {
        baseClasses += " bg-indigo-100 border-gray-400 text-gray-500";
      } else {
        baseClasses += " bg-gray-100 border-gray-400 text-gray-500";
      }
      if (index === activeQuestionNumber - 1) {
        baseClasses += " border-violet-700 text-violet-700 bg-violet-100";
      }

      return baseClasses;
    },
    [activeQuestionNumber],
  );

  return (
    <div className="p-4 border border-gray-300 rounded-lg flex flex-col gap-y-3 max-w-[250px] bg-white shadow hover:shadow-md max-h-[310px]">
      {expiresAt ? (
        <Timer />
      ) : (
        <div className="text-gray-600 leading-tight">No time limit</div>
      )}

      <hr className="border-gray-300 -mx-4" />

      <h3 className="text-gray-600 leading-tight">Questions</h3>

      {/* Grid for question numbers */}
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(35px,1fr))] overflow-y-auto">
        {questions.map((question: QuestionStore, index) => (
          <button
            key={index}
            id={`indexQuestion-${index + 1}`}
            onClick={() => setActiveQuestionNumber(index + 1)}
            className={getQuestionButtonClasses(question, index)}
          >
            <div className="font-bold text-lg mb-2">{index + 1}</div>
            {question.status === "flagged" && (
              <IconBookmarkFilled className="text-yellow-700" size={16} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default Overview;
