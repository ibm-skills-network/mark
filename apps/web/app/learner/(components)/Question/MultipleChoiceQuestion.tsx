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

  const handleChoiceClick = (choiceIndex: number) => {
    if (isSingleCorrect) {
      choices.forEach((_, index) => {
        removeChoice(String(index), question.id); // Remove by index
      });
      addChoice(String(choiceIndex), question.id); // Add index
    } else {
      if (learnerChoices?.includes(String(choiceIndex))) {
        removeChoice(String(choiceIndex), question.id);
      } else {
        addChoice(String(choiceIndex), question.id);
      }
    }
  };

  if (!choices || choices.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-y-3 mt-4">
      {choices.map((choice, index) => {
        const isSelected = learnerChoices?.includes(String(index)); // Check selection by index

        return (
          <button
            key={index}
            type="button"
            className={cn(
              "flex items-center w-full p-3 rounded-lg transition-colors duration-200",
              "text-lg font-normal",
              isSelected
                ? "  text-violet-900"
                : "bg-white text-gray-800 hover:bg-gray-50",
            )}
            onClick={() => handleChoiceClick(index)} // Store index instead of text
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
            {choice.choice} {/* Display text normally */}
          </button>
        );
      })}
    </div>
  );
}

export default MultipleChoiceQuestion;
