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
    <div className="p-4 border rounded-lg">
      <h3 className="mb-4 text-lg font-bold">Exam Overview</h3>
      <div className="mb-4 flex flex-wrap gap-2">
        {/* Flexbox container */}
        {questions.map((question: QuestionStatus, index) => (
          <div
            key={index}
            onClick={() => setCurrentIndex(index)} // Redirect to the clicked question
            className={`p-2 border rounded-lg text-center cursor-pointer flex-1 ${
              question === "correct"
                ? "bg-green-100"
                : question === "incorrect"
                ? "bg-red-100"
                : question === "partiallyCorrect"
                ? "bg-yellow-100"
                : "bg-gray-100"
            }`}
          >
            Question {index + 1}: {question === "correct" && "✓"}
            {question === "incorrect" && "✗"}
            {question === "partiallyCorrect" && "✓✗"}
            {question === "unanswered" && "Unanswered"}
          </div>
        ))}
      </div>
      <div>
        Time remaining: {Math.floor(secondsRemaining / 60)}:
        {(secondsRemaining % 60).toString().padStart(2, "0")}
      </div>
    </div>
  );
}

export default Overview;
