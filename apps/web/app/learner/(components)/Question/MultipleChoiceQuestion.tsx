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
        removeChoice(String(index), question.id);
      });
      addChoice(String(choiceIndex), question.id);
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
    <div className="flex flex-col gap-y-3 mt-4 w-full">
      {choices.map((choice, index) => {
        const isSelected = learnerChoices?.includes(String(index));

        return (
          <button
            key={index}
            type="button"
            className={cn(
              "flex w-full p-3 rounded-lg transition-colors duration-200",
              "text-lg font-normal",
              isSelected
                ? "text-violet-900"
                : "bg-white text-gray-800 hover:bg-gray-50",
            )}
            onClick={() => handleChoiceClick(index)}
          >
            <div className="flex items-start w-full overflow-hidden">
              <span
                className={cn(
                  "mt-1 mr-3 flex-shrink-0 flex items-center justify-center transition-all",
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
              <div className="whitespace-pre-wrap break-words hyphens-auto text-left overflow-hidden w-full">
                {choice.choice}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default MultipleChoiceQuestion;
