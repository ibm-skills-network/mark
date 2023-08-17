import React from 'react';
import IntroductionPage from "./IntroductionPage";
import LongFormQuestion from './LongFormQuestion';

interface Props {}

function LearnerLayout(props: Props) {
  const {} = props;
  const questionText = "Describe the key elements of a project charter and explain why it is considered a critical document in project management. How does a project charter contribute to project success?";
  const instructions = "Start writing your answer here.";
  const points = 10;

  return (
    <div className="">
      <IntroductionPage
        attemptsAllowed={1}
        timeLimit={50}
        outOf={40}
      />
      <LongFormQuestion
        questionText={questionText}
        instructions={instructions}
        points={points}
      />
    </div>
  );
}

export default LearnerLayout;
