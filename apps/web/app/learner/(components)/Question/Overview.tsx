import { cn } from "@/lib/strings";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import type { QuestionStatus } from "@config/types"; // Ensure this type is updated as specified below
import { useMemo, type ComponentPropsWithoutRef } from "react";
import Timer from "./Timer";

interface Props extends ComponentPropsWithoutRef<"div"> {}

function Overview(props: Props) {
  const [
    questionsStore,
    activeQuestionNumber,
    setActiveQuestionNumber,
    expiresAt,
  ] = useLearnerStore((state) => [
    state.questions,
    state.activeQuestionNumber,
    state.setActiveQuestionNumber,
    state.expiresAt,
  ]);

  const questionStatus = useMemo(() => {
    return questionsStore.map((question) => {
      // get the higest points earned for the question by finding the highest points earned for each response
      const earnedPoints =
        question.questionResponses.length > 0
          ? Math.max(
              ...question.questionResponses.map((response) => response.points),
            )
          : -1;
      if (question.totalPoints === earnedPoints) {
        return "correct";
      }
      if (earnedPoints > 0) {
        return "partiallyCorrect";
        // TODO: add other types of questions
      }
      if (earnedPoints === 0) {
        return "incorrect";
      }
      if (earnedPoints === -1) {
        if (
          question?.learnerTextResponse ||
          question?.learnerUrlResponse ||
          question?.learnerChoices?.length > 0
        ) {
          return "edited";
        }
        return "unedited";
      }
    });
  }, [questionsStore]);
  return (
    <div className="p-4 border border-gray-300 rounded-lg flex flex-col gap-y-3 w-64 max-w-xl bg-white">
      {expiresAt ? (
        <Timer expiresAt={expiresAt} />
      ) : (
        <div className="text-gray-600 leading-tight">No time limit</div>
      )}

      <hr className="border-gray-300 -mx-4" />

      <h3 className="text-gray-600 leading-tight">Questions</h3>
      <div className="grid gap-1.5 grid-cols-5">
        {questionStatus.map((question: QuestionStatus, index) => (
          <button
            key={index}
            onClick={() => setActiveQuestionNumber(index + 1)}
            className={cn(
              "p-0.5 w-10 h-14 border rounded-md text-center grid grid-rows-2 cursor-pointer focus:outline-none",
              question === "edited" ? "bg-indigo-100" : "bg-gray-100",
              index === activeQuestionNumber - 1
                ? "border-blue-700 text-blue-700 bg-blue-100"
                : "border-gray-400 text-gray-500",
            )}
          >
            <div className="leading-5 font-bold my-auto">{index + 1}</div>

            {question === "correct" && <div className="text-green-600">✓</div>}
            {question === "incorrect" && <div className="text-red-600">✗</div>}
            {question === "partiallyCorrect" && (
              <div className="text-orange-500">✓</div>
            )}
            {/* {question === "edited" && <div className="text-gray-600">-</div>} */}
          </button>
        ))}
      </div>
    </div>
  );
}

export default Overview;
