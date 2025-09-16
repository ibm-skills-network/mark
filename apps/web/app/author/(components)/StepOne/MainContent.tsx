"use client";

import animationData from "@/animations/LoadSN.json";
import LoadingPage from "@/app/loading";
import MarkdownEditor from "@/components/MarkDownEditor";
import { useAuthorStore } from "@/stores/author";
import SectionWithTitle from "../ReusableSections/SectionWithTitle";
import React from "react";

const stepOneSections = {
  introduction: {
    title: "1. What is this assignment about?",
    description:
      "Write a short summary of the assignment and it's objectives. This will be the first thing learners see when they open the assignment.",
    placeholder: `E.g. This assignment tests your knowledge on the topic of climate change and focuses on the content found in labs 1 and 3. Please review those labs if you are not ready to take this assignment.
Good luck!`,
    required: true,
  },
  instructions: {
    title:
      "2. What are the instructions to successfully completing this assignment?",
    description:
      "Give learners instructions so they can complete this assignment to this best of their abilities",
    placeholder: "E.g Cite your sources at the end of every short answer.",
    required: false,
  },
  overview: {
    title: "3. How will learners be graded on this assignment?",
    description: "Explain the grading criteria for learners",
    placeholder:
      "E.g 1. State the country that is most affected by climate change (1 pt)...",
    required: false,
  },
  grading: {
    title: "Adjust Settings",
    description: "Select the options that you want to apply to your assignment",
    placeholder: "",
    required: true,
  },
} as const;

const MainContent = () => {
  const [
    introduction,
    setIntroduction,
    instructions,
    setInstructions,
    gradingCriteriaOverview,
    setGradingCriteriaOverview,
    pageState,
    errors,
  ] = useAuthorStore((state) => [
    state.introduction,
    state.setIntroduction,
    state.instructions,
    state.setInstructions,
    state.gradingCriteriaOverview,
    state.setGradingCriteriaOverview,
    state.pageState,
    state.errors,
  ]);

  if (pageState === "loading") {
    return <LoadingPage animationData={animationData} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <SectionWithTitle
        title={stepOneSections.introduction.title}
        description={stepOneSections.introduction.description}
        required={stepOneSections.introduction.required}
        error={errors.introduction}
      >
        <MarkdownEditor
          value={introduction}
          setValue={setIntroduction}
          placeholder={stepOneSections.introduction.placeholder}
        />
      </SectionWithTitle>
      <SectionWithTitle
        title={stepOneSections.instructions.title}
        description={stepOneSections.instructions.description}
        required={stepOneSections.instructions.required}
        error={errors.instructions}
      >
        <MarkdownEditor
          value={instructions}
          setValue={setInstructions}
          placeholder={stepOneSections.instructions.placeholder}
        />
      </SectionWithTitle>
      <SectionWithTitle
        title={stepOneSections.overview.title}
        description={stepOneSections.overview.description}
        required={stepOneSections.overview.required}
        error={errors.gradingCriteriaOverview}
      >
        <MarkdownEditor
          value={gradingCriteriaOverview}
          setValue={setGradingCriteriaOverview}
          placeholder={stepOneSections.overview.placeholder}
        />
      </SectionWithTitle>
    </div>
  );
};

export default MainContent;
