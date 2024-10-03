import { QuestionStore } from "@/config/types";
import { cn } from "@/lib/strings";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";

interface MultipleChoiceQuestion {
  isSingleCorrect: boolean; // New prop to control whether the question allows single or multiple correct answers
  question: QuestionStore;
}

function MultipleChoiceQuestion({
  isSingleCorrect,
  question,
}: MultipleChoiceQuestion) {
  const [addChoice, removeChoice] = useLearnerStore((state) => [
    state.addChoice,
    state.removeChoice,
  ]);
  const { choices, learnerChoices } = question;

  const handleChoiceClick = (choice: string) => {
    if (isSingleCorrect) {
      choices.forEach((c) => {
        // deselect all choices
        removeChoice(c.choice, question.id);
      });
      // select the clicked choice
      addChoice(choice, question.id);
    } else {
      // Multiple correct behavior: toggle the choice
      if (learnerChoices?.includes(choice)) {
        removeChoice(choice, question.id);
      } else {
        addChoice(choice, question.id);
      }
    }
  };

  if (!choices || choices.length === 0) {
    return null;
  }

  return (
    <>
      {choices.map((choice, index) => {
        const { choice: choiceText } = choice;
        let bgColor = "";
        if (learnerChoices?.includes(choiceText)) {
          bgColor = "bg-blue-100"; // Selected but not answered yet
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

export default MultipleChoiceQuestion;
