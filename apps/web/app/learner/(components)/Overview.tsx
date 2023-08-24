"use client";

import { QuestionStatus } from "@config/types";
import React, { useEffect, useState } from "react";

interface Props {
  questions: QuestionStatus[];
  timeLimit: number; // Time limit in seconds
  setCurrentIndex: (index: number) => void;
}

function Overview(props: Props) {
  const { questions, timeLimit, setCurrentIndex } = props;
  const [secondsRemaining, setSecondsRemaining] = useState<number>(timeLimit);

  // Timer logic to decrement the seconds remaining
  useEffect(() => {
    const timer = setInterval(() => {
      if (secondsRemaining > 0) {
        setSecondsRemaining(secondsRemaining - 1);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining]);

  return (
    <div className="p-4 border rounded-lg space-y-4 w-full max-w-xl mx-auto">
      <h3 className="mb-4 text-lg font-bold text-center">Exam Overview</h3>

      <div className="text-center font-medium">
        Time remaining: {Math.floor(secondsRemaining / 60)}:
        {(secondsRemaining % 60).toString().padStart(2, "0")}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {questions.map((question: QuestionStatus, index) => (
          <div
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`p-2 border rounded-lg text-center cursor-pointer ${
              question === "correct"
                ? "bg-green-100"
                : question === "incorrect"
                ? "bg-red-100"
                : question === "partiallyCorrect"
                ? "bg-yellow-100"
                : "bg-gray-100"
            }`}
          >
            <div>{index + 1}</div>{" "}
            {/* Displaying just the number on a separate line */}
            {question === "correct" && <div className="text-green-600">✓</div>}
            {question === "incorrect" && <div className="text-red-600">✗</div>}
            {question === "partiallyCorrect" && <div>✓✗</div>}
            {/* Removed the unanswered status */}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Overview;
