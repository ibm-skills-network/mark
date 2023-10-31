import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import type { QuestionStatus } from "@config/types"; // Ensure this type is updated as specified below
import { useMemo, type ComponentPropsWithoutRef } from "react";
import { twMerge } from "tailwind-merge";
import Timer from "./Timer";

interface Props extends ComponentPropsWithoutRef<"div"> {}

function Overview(props: Props) {
  const {} = props;

  const [questionsStore, activeQuestionNumber, setActiveQuestionNumber] =
    useLearnerStore((state) => [
      state.questions,
      state.activeQuestionNumber,
      state.setActiveQuestionNumber,
    ]);
  const assignmentDetails = useAssignmentDetails(
    (state) => state.assignmentDetails
  );
  const id = assignmentDetails?.id;
  const allotedTimeMinutes = assignmentDetails?.allotedTimeMinutes;
  // TODO: use the allotedTimeMinutes variable

  const questionStatus = useMemo(() => {
    return questionsStore.map((question) => {
      // get the higest points earned for the question by finding the highest points earned for each response
      const earnedPoints =
        question?.questionResponses?.reduce((highestPoints, response) => {
          return response.points > highestPoints
            ? response.points
            : highestPoints;
        }, 0) || 0;
      if (question.totalPoints === earnedPoints) {
        return "correct";
      } else if (earnedPoints > 0) {
        return "partiallyCorrect";
        // TODO: add other types of questions
      } else if (earnedPoints === 0 && question?.learnerTextResponse) {
        return "edited";
        // TODO: figure out how to check if the question has been submitted and is incorrect
      } else if (earnedPoints === 0 && !!false) {
        return "incorrect";
      } else {
        return "unedited";
      }
    });
  }, [questionsStore]);
  return (
    <div className="p-4 border border-gray-300 rounded-lg flex flex-col gap-y-3 w-64 max-w-xl bg-white">
      {allotedTimeMinutes ? (
        <Timer />
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
            className={twMerge(
              "p-0.5 w-10 h-14 border rounded-md text-center grid grid-rows-2 cursor-pointer focus:outline-none",
              question === "edited" ? "bg-indigo-100" : "bg-gray-100",
              index === activeQuestionNumber - 1
                ? "border-blue-700 text-blue-700 bg-blue-100"
                : "border-gray-400 text-gray-500"
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
