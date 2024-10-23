import { QuestionStore } from "@/config/types";
import { cn } from "@/lib/strings";
import { useLearnerStore } from "@/stores/learner";

interface MultipleChoiceQuestion {
  isSingleCorrect: boolean;
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
        removeChoice(c.choice, question.id);
      });
      addChoice(choice, question.id);
    } else {
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
    <div className="flex flex-col gap-y-3 mt-4">
      {choices.map((choice, index) => {
        const { choice: choiceText } = choice;
        const isSelected = learnerChoices?.includes(choiceText);

        return (
          <button
            key={index}
            type="button"
            className={cn(
              "flex items-center w-full p-3 rounded-lg transition-colors duration-200",
              "text-lg font-medium",
              isSelected
                ? "  text-violet-900"
                : "bg-white  text-gray-800 hover:bg-gray-50",
            )}
            onClick={() => handleChoiceClick(choiceText)}
          >
            <span
              className={cn(
                "mr-3 flex items-center justify-center transition-all",
                isSingleCorrect
                  ? "w-4 h-4 rounded-full border-2 border-violet-500"
                  : "w-4 h-4 border-2 border-violet-500 rounded",
                isSelected &&
                  (isSingleCorrect
                    ? "bg-violet-500"
                    : "bg-violet-500 text-white"),
              )}
            >
              {isSelected ? (
                isSingleCorrect ? (
                  <span className="block w-1.5 h-1.5 bg-white rounded-full" />
                ) : (
                  <span className="block w-4 h-4 bg-violet-500 rounded" />
                )
              ) : null}
            </span>
            {choiceText}
          </button>
        );
      })}
    </div>
  );
}

export default MultipleChoiceQuestion;
