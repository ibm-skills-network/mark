import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { useState } from "react";

interface Props {}

function TrueFalseQuestion(props: Props) {
  const {} = props;
  const activeQuestionNumber = useLearnerStore(
    (state) => state.activeQuestionNumber
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
    (state) => state.assignmentDetails?.id
  );

  const handleChoiceClick = (choice: string) => {
    if (!questionResponses.length) {
      if (learnerChoices.includes(choice)) {
        removeChoice(choice);
      } else {
        addChoice(choice);
      }
    }
  };

  if (!choices || choices.length === 0) {
    return null;
  }
  return (
    <>
      {choices.map((choice, index) => {
        const { isCorrect, choice: choiceText } = choice;
        return (
          <button
            key={index}
            className={`block w-full text-left p-2 mb-2 border rounded ${
              questionResponses.length // if question is answered
                ? learnerChoices.includes(choiceText)
                  ? isCorrect
                    ? "bg-teal-100" // if choice is selected and question is answered correctly
                    : "bg-amber-100" // if choice is selected and question is answered incorrectly
                  : ""
                : learnerChoices.includes(choiceText)
                ? "bg-blue-100" // if choice is selected but question is not answered
                : ""
            }`}
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
