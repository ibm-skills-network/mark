"use client"
import React, { useState } from "react";
import AuthorHeader from "./(author)/components/AuthorHeader";
import AuthorLayout from "./(author)/components/AuthorLayout";
import IntroductionPage from "./(learner)/components/IntroductionPage";
import LearnerHeader from "./(learner)/components/LearnerHeader";
import LearnerLayout from "./(learner)/components/LearnerLayout";

export default function Home() {
  const role = "learner";
  const [showIntroduction, setShowIntroduction] = useState(true);

  const beginAssignment = () => {
    setShowIntroduction(false);
  };

  return (
    <>
      {role === "author" ? (
        <AuthorHeader />
      ) : (
        <LearnerHeader attemptsAllowed={1} timeLimit={50} outOf={40} />
      )}
      <main className="flex flex-col items-center justify-between min-h-screen">
        {role === "author" ? (
          <AuthorLayout />
        ) : showIntroduction ? (
          <IntroductionPage attemptsAllowed={1} timeLimit={50} outOf={40} onBegin={beginAssignment} />
        ) : (
          <LearnerLayout />
        )}
      </main>
    </>
  );
}
