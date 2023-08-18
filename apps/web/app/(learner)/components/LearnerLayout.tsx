import React from "react";
import IntroductionPage from "./IntroductionPage";
import LongFormQuestion from "./LongFormQuestion";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion"; // Import the new component

interface Props {}

function LearnerLayout(props: Props) {
  const {} = props;
  const questionText1 =
    "Describe the key elements of a project charter and explain why it is considered a critical document in project management. How does a project charter contribute to project success?";
  const instructions = "Start writing your answer here.";
  const points1 = 10;

  // Define question text and options for the multiple-choice question
  const questionText2 = "Choose the correct option.";
  const options = ["Option 1", "Option 2", "Option 3", "Option 4"];
  const points2 = 5;
  const correctOptions = ["Option 1", "Option 2"]

  return (
    <div className="">
      <IntroductionPage attemptsAllowed={1} timeLimit={50} outOf={40} />
      <LongFormQuestion
        questionText={questionText1}
        instructions={instructions}
        points={points1}
      />
      <MultipleChoiceQuestion // Add the new component
        correctOptions={correctOptions}
        questionText={questionText2}
        options={options}
        points={points2}
      />
    </div>
  );
}

export default LearnerLayout;
