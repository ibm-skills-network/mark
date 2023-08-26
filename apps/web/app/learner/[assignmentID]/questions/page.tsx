"use client";

import { QuestionStatus } from "@/config/types";
import { QuestionData, questionsData } from "@config/constants";
import Button from "@learnerComponents/Button";
import LongFormQuestion from "@learnerComponents/LongFormQuestion";
import MultipleChoiceQuestion from "@learnerComponents/MultipleChoiceQuestion";
import Overview from "@learnerComponents/Overview";
import { useState } from "react";

function LearnerLayout() {
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [questionStatuses, setQuestionStatuses] = useState<QuestionStatus[]>(
    questionsData.map(() => "unanswered")
  );

  const [showIntroduction, setShowIntroduction] = useState(true);

  const beginAssignment = () => {
    setShowIntroduction(false);
  };

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
          maxAttempts={3}
          questionNumber={questionNumber}
          onAnswerSelected={updateStatus}
        />
      );
    }
  };
  return (
    <main className="p-24">
      <div className="flex p-8">
        {" "}
        {/* Added padding to give some space between components */}
        <div className="w-3/4 pr-8 min-h-screen">
          {" "}
          {/* Added right padding and min-height */}
          <div className="bg-white p-4 shadow-lg rounded-lg">
            {" "}
            {/* Added a container with padding, shadow, and rounded corners for better separation */}
            {renderQuestion(questionsData[currentIndex], currentIndex)}
          </div>
          <div className="flex justify-between mt-4">
            <Button
              onClick={() => setCurrentIndex(currentIndex - 1)}
              disabled={currentIndex === 0}
            >
              Previous
            </Button>
            <Button
              onClick={() => setCurrentIndex(currentIndex + 1)}
              disabled={currentIndex === questionsData.length - 1}
            >
              {" "}
              Next{" "}
            </Button>
          </div>
        </div>
        <div className="w-1/4 min-h-screen">
          {" "}
          {/* Added min-height */}
          <Overview
            questions={questionStatuses}
            timeLimit={3600}
            setCurrentIndex={setCurrentIndex}
          />
        </div>
      </div>
    </main>
  );
}

export default LearnerLayout;
