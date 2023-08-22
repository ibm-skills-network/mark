"use client";
"use client";

import React, { useState } from "react";
import Button from "./Button";
import LongFormQuestion from "./LongFormQuestion";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import Overview from "./Overview";
import { QuestionData, questionsData } from "./questions";

function LearnerLayout() {
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [questionStatuses, setQuestionStatuses] = useState<
    Array<"correct" | "incorrect" | "partiallyCorrect" | "unanswered">
  >(questionsData.map(() => "unanswered"));

  const updateStatus = (
    status: "correct" | "incorrect" | "partiallyCorrect"
  ) => {
    setQuestionStatuses((prevStatuses) => {
      const updatedStatuses = [...prevStatuses];
      updatedStatuses[currentIndex] = status;
      return updatedStatuses;
    });
  };

  const renderQuestion = (question: QuestionData, index: number) => {
    const questionNumber = index + 1;

    if (question.type === "longForm") {
      return <LongFormQuestion {...question} questionNumber={questionNumber} />;
    } else {
      return (
        <MultipleChoiceQuestion
          {...question}
          questionNumber={questionNumber}
          onAnswerSelected={updateStatus}
        />
      );
    }
  };

  return (
    <div className="flex">
      <div className="w-3/4">
        {renderQuestion(questionsData[currentIndex], currentIndex)}
        <div className="flex justify-between mt-4">
          <Button
            text="Previous"
            onClick={() => setCurrentIndex(currentIndex - 1)}
            disabled={currentIndex === 0}
          />
          <Button
            text="Next"
            onClick={() => setCurrentIndex(currentIndex + 1)}
            disabled={currentIndex === questionsData.length - 1}
          />
        </div>
      </div>
      <div className="w-1/4">
        <Overview
          questions={questionStatuses.map((status) => ({ status }))}
          timeLimit={3600}
          setCurrentIndex={setCurrentIndex}
        />
      </div>
    </div>
  );
}

export default LearnerLayout;
