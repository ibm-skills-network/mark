import React, { useState } from "react";
import IntroductionPage from "./IntroductionPage";
import LearnerLayout from "./LearnerLayout";

interface Props {}

function TestContainer(props: Props) {
  const {} = props;
  const [showIntroduction, setShowIntroduction] = useState<boolean>(true);

  return (
    <div className="">
      {showIntroduction ? (
        <IntroductionPage
          attemptsAllowed={1}
          timeLimit={50}
          outOf={40}
          onBegin={() => setShowIntroduction(false)}
        />
      ) : (
        <LearnerLayout />
      )}
    </div>
  );
}

export default TestContainer;