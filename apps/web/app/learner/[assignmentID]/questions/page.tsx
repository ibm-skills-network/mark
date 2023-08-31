"use client";

import TextQuestion from "@/app/learner/(components)/TextQuestion";
import { Question, QuestionStatus } from "@/config/types";
import { questionsData } from "@config/constants";
import Button from "@learnerComponents/Button";
import MultipleChoiceQuestion from "@learnerComponents/MultipleChoiceQuestion";
import Overview from "@learnerComponents/Overview";
import QuestionContainer from "@learnerComponents/QuestionContainer";
import { useState } from "react";

function LearnerLayout() {
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [questionStatuses, setQuestionStatuses] = useState<QuestionStatus[]>(
    questionsData.map(() => "unanswered")
  );

  const updateStatus = (status: QuestionStatus) => {
    setQuestionStatuses((prevStatuses) => {
      const updatedStatuses = [...prevStatuses];
      updatedStatuses[currentIndex] = status;
      return updatedStatuses;
    });
  };

  return (
    <main className="p-24 grid grid-cols-4 gap-x-5">
      {/* Added padding to give some space between components */}
      <div className="col-span-3 -mt-6">
        {/* Added a container with padding, shadow, and rounded corners for better separation */}
        {questionsData.map((question, index) => {
          return (
            <QuestionContainer
              key={index}
              questionNumber={index + 1}
              className={`${index === currentIndex ? "" : "hidden"} `}
              question={question}
              updateStatus={updateStatus}
            />
          );
        })}

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
            Next
          </Button>
        </div>
      </div>
      <div className="col-span-1">
        <Overview
          questions={questionStatuses}
          timeLimit={3600}
          setCurrentIndex={setCurrentIndex}
        />
      </div>
    </main>
  );
}

export default LearnerLayout;
