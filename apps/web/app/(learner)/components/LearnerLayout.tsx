"use client"
import React, { useState } from "react";
import IntroductionPage from "./IntroductionPage";
import LongFormQuestion from "./LongFormQuestion";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import Overview from "./Overview"; // Import the Overview component

interface Props {}

/**
 * The main layout for the learner's interface including questions and overview
 * @param {Props} props - Properties passed to the component (none in this case)
 */
function LearnerLayout(props: Props) {
  const {} = props;
  
  // Long form question data
  const questionText1 =
    "Describe the key elements of a project charter and explain why it is considered a critical document in project management. How does a project charter contribute to project success?";
  const instructions = "Start writing your answer here.";
  const points1 = 10;

  // Multiple-choice question data
  const questionText2 = "Choose the correct option.";
  const options = ["Option 1", "Option 2", "Option 3", "Option 4"];
  const points2 = 5;
  const correctOptions = ["Option 1", "Option 2"]

  // Questions' statuses
  const [questions, setQuestions] = useState([
    { status: 'unanswered' },
    { status: 'unanswered' },
    // Add more questions as needed
  ]);

  // Time limit for the Overview component (in seconds)
  const timeLimit = 50 * 60; // 50 minutes

  // Handler function to update the status of a question
  const updateQuestionStatus = (index: number, status: "correct" | "incorrect" | "partiallyCorrect" | "unanswered") => {
    setQuestions(prevQuestions => {
      const updatedQuestions = [...prevQuestions];
      updatedQuestions[index].status = status;
      return updatedQuestions;
    });
  };

  return (
    <div className="flex">
      <div className="w-3/4">
        <IntroductionPage attemptsAllowed={1} timeLimit={50} outOf={40} />
        <LongFormQuestion
          questionText={questionText1}
          instructions={instructions}
          points={points1}
          onAnswered={(status) => updateQuestionStatus(0, status)}
        />
        <MultipleChoiceQuestion
          correctOptions={correctOptions}
          questionText={questionText2}
          options={options}
          points={points2}
          onAnswerSelected={(status) => updateQuestionStatus(1, status)}
        />
      </div>
      <div className="w-1/4">
        <Overview questions={questions} timeLimit={timeLimit} />
      </div>
    </div>
  );
}

export default LearnerLayout;
