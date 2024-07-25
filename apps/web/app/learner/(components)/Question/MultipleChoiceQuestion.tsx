import { cn } from "@/lib/strings";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { useState } from "react";

function TrueFalseQuestion() {
  const activeQuestionNumber = useLearnerStore(
    (state) => state.activeQuestionNumber,
  );

  const [questions, addChoice, removeChoice] = useLearnerStore((state) => [
    state.questions,
    state.addChoice,
    state.removeChoice,
  ]);
  const { question, id, choices, learnerChoices, questionResponses } =
    questions[activeQuestionNumber - 1];
  // const {} = questionResponses.at(-1);

  const assignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id,
  );

  const handleChoiceClick = (choice: string) => {
    if (learnerChoices.includes(choice)) {
      removeChoice(choice);
    } else {
      addChoice(choice);
    }
  };

  if (!choices || choices.length === 0) {
    return null;
  }
  return (
    <>
      {choices.map((choice, index) => {
        const { isCorrect, choice: choiceText } = choice;
        let bgColor = "";

        // TODO: Fix: Answers are revealed after the learner submits the Q
        if (questionResponses.length) {
          // if question is answered
          if (learnerChoices.includes(choiceText)) {
            if (isCorrect) {
              bgColor = "bg-green-100"; // if choice is selected and question is answered correctly
            } else {
              bgColor = "bg-red-100"; // if choice is selected and question is answered incorrectly
            }
          }
        } else {
          if (learnerChoices.includes(choiceText)) {
            bgColor = "bg-blue-100"; // if choice is selected but question is not answered
          }
        }
        return (
          <button
            key={index}
            type="button"
            className={cn(
              "block w-full text-left p-2 mb-2 border rounded",
              bgColor,
            )}
            onClick={() => handleChoiceClick(choiceText)}
          >
            {choiceText}
          </button>
        );
      })}
    </>
  );
}

export default TrueFalseQuestion;
