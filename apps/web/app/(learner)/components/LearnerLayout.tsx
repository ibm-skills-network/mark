"use client"
import React, { useState } from "react";
import Button from "./Button"; // Import the Button component
import IntroductionPage from "./IntroductionPage";
import LongFormQuestion from "./LongFormQuestion";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import Overview from "./Overview";
import { questionsData, QuestionData } from './questions';

interface Props {}

interface QuestionStatus {
  status: "correct" | "incorrect" | "partiallyCorrect" | "unanswered";
}

function LearnerLayout(props: Props) {
  const timeLimit = 50 * 60; // 50 minutes

  const [questions, setQuestions] = useState<QuestionStatus[]>(
    Array(questionsData.length).fill({ status: "unanswered" })
  );
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  const updateQuestionStatus = (index: number, status: "correct" | "incorrect" | "partiallyCorrect" | "unanswered") => {
    setQuestions(prevQuestions => {
      const updatedQuestions = [...prevQuestions];
      updatedQuestions[index].status = status;
      return updatedQuestions;
    });
  };

  const renderQuestion = (question: QuestionData, index: number) => {
    switch (question.type) {
      case 'longForm':
        return <LongFormQuestion
                  questionText={question.questionText}
                  instructions={question.instructions}
                  points={question.points}
                  onAnswered={(status) => updateQuestionStatus(index, status)}
                />;
      case 'multipleChoice':
        return <MultipleChoiceQuestion
                  correctOptions={question.correctOptions}
                  questionText={question.questionText}
                  options={question.options}
                  points={question.points}
                  onAnswerSelected={(status) => updateQuestionStatus(index, status)}
                />;
    }
  };

  return (
    <div className="flex">
      <div className="w-3/4">
        <IntroductionPage attemptsAllowed={1} timeLimit={50} outOf={40} />
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
        <Overview questions={questions} timeLimit={timeLimit} />
      </div>
    </div>
  );
}

export default LearnerLayout;

