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
  const { question, id, choices, learnerChoices } =
    questions[activeQuestionNumber - 1];
  console.log("choices", choices);

  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState<boolean>(false);

  const assignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id
  );

  const handleChoiceClick = (choice: string) => {
    if (!submitted) {
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
        // TODO: resolve this when backend is ready for it
        const isChoiceCorrect = false;
        console.log("isChoiceCorrect", isChoiceCorrect);
        console.log("learnerChoices", learnerChoices);
        return (
          <button
            key={index}
            className={`block w-full text-left p-2 mb-2 border rounded ${
              submitted
                ? learnerChoices.includes(choice)
                  ? isChoiceCorrect
                    ? "bg-green-100 text-black"
                    : "bg-red-100 text-black"
                  : "text-black"
                : learnerChoices.includes(choice)
                ? "bg-blue-100 text-black"
                : "text-black"
            }`}
            onClick={() => handleChoiceClick(choice)}
          >
            {choice}
          </button>
        );
      })}
    </>
  );
}

export default TrueFalseQuestion;
