import { useLearnerStore } from "@/stores/learner";
import type { QuestionStatus } from "@config/types"; // Ensure this type is updated as specified below
import { ComponentPropsWithoutRef, useEffect, useMemo, useState } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {}

function Overview(props: Props) {
  const {} = props;

  const questionsStore = useLearnerStore((state) => state.questions);
  const [activeQuestionId, setActiveQuestionId] = useLearnerStore((state) => [
    state.activeQuestionId,
    state.setActiveQuestionId,
  ]);

  // TODO: use the allotedTimeMinutes variable
  const [secondsRemaining, setSecondsRemaining] = useState<number>(3600);
  // const [questionStatuses, setQuestionStatuses] = useState<QuestionStatus[]>(
  //   questionsStore.map(() => "unedited")
  // );
  const questionStatus = useMemo(() => {
    return questionsStore.map((question) => {
      // get the higest points earned for the question by finding the highest points earned for each response
      const earnedPoints =
        question?.questionResponses?.reduce((highestPoints, response) => {
          return response.points > highestPoints
            ? response.points
            : highestPoints;
        }, 0) || 0;
      console.log("question", question.questionResponses);
      if (question.learnerTextResponse === "") {
        return "unedited";
      } else if (question.totalPoints === earnedPoints) {
        return "correct";
      } else if (earnedPoints > 0) {
        return "partiallyCorrect";
      } else {
        return "incorrect";
      }
    });
  }, [questionsStore]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (secondsRemaining > 0) {
        setSecondsRemaining(secondsRemaining - 1);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining]);

  return (
    <div className="p-4 border border-gray-300 rounded-lg space-y-4 w-full max-w-xl mx-auto bg-white">
      <h3 className="mb-4 text-lg font-bold text-center">Exam Overview</h3>

      <div className="flex items-center space-x-2">
        <div className="text-gray-600 text-base font-medium leading-tight">
          Time Remaining:
        </div>
        <div className="text-blue-600 text-base font-bold leading-tight">
          {Math.floor(secondsRemaining / 60)}:
          {secondsRemaining % 60 < 10
            ? `0${secondsRemaining % 60}`
            : secondsRemaining % 60}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {questionStatus.map((question: QuestionStatus, index) => (
          <button
            key={index}
            onClick={() => setActiveQuestionId(index + 1)}
            className={`p-2 border rounded-lg text-center cursor-pointer focus:outline-none 
              ${question === "correct" ? "bg-green-100 border-green-500" : ""}
              ${question === "incorrect" ? "bg-red-100 border-red-500" : ""}
              ${
                question === "partiallyCorrect"
                  ? "bg-yellow-100 border-yellow-500"
                  : ""
              }
              ${question === "edited" ? "bg-gray-100 border-gray-300" : ""}
              ${question === "unedited" ? "bg-white-100 border-white-300" : ""}
            `}
          >
            <div className="text-sm font-medium">{index + 1}</div>

            {question === "correct" && (
              <div className="text-green-600 mt-1">✓</div>
            )}
            {question === "incorrect" && (
              <div className="text-red-600 mt-1">✗</div>
            )}
            {question === "partiallyCorrect" && (
              <div className="text-orange-600 mt-1">✓✗</div>
            )}
            {question === "edited" && (
              <div className="text-gray-600 mt-1">-</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default Overview;
