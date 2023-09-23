import { useLearnerStore } from "@/stores/learner";
import type { QuestionStatus } from "@config/types"; // Ensure this type is updated as specified below
import { useEffect, useState } from "react";

interface Props {
  timeLimit: number; // Time limit in seconds
  setCurrentIndex: (index: number) => void;
}

function Overview(props: Props) {
  const { timeLimit, setCurrentIndex } = props;

  const questionsStore = useLearnerStore((state) => state.questions);

  const [secondsRemaining, setSecondsRemaining] = useState<number>(timeLimit);
  const [questionStatuses, setQuestionStatuses] = useState<QuestionStatus[]>(
    questionsStore.map(() => "unedited")
  );
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
        {/* {questionstatus.map((question: QuestionStatus, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`p-2 border rounded-lg text-center cursor-pointer focus:outline-none 
              ${question === "correct" ? "bg-green-100 border-green-500" : ""}
              ${question === "incorrect" ? "bg-red-100 border-red-500" : ""}
              ${
                question === "partiallyCorrect"
                  ? "bg-yellow-100 border-yellow-500"
                  : ""
              }
              ${question === "answered" ? "bg-gray-100 border-gray-300" : ""}
              ${
                question === "unanswered" ? "bg-white-100 border-white-300" : ""
              }
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
            {question === "answered" && (
              <div className="text-gray-600 mt-1">-</div>
            )}
          </button>
        ))} */}
      </div>
    </div>
  );
}

export default Overview;
