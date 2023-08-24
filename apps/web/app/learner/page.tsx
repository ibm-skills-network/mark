"use client";

import { QuestionStatus } from "@/config/types";
import { QuestionData, questionsData } from "@config/constants";
import { useState } from "react";
import Button from "./(components)/Button";
import IntroductionPage from "./(components)/IntroductionPage";
import LongFormQuestion from "./(components)/LongFormQuestion";
import MultipleChoiceQuestion from "./(components)/MultipleChoiceQuestion";
import Overview from "./(components)/Overview";

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
      {showIntroduction ? (
        <IntroductionPage
          className=""
          attemptsAllowed={1}
          timeLimit={50}
          outOf={40}
          onBegin={beginAssignment}
        />
      ) : (
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
      )}
    </main>
  );
}

export default LearnerLayout;
