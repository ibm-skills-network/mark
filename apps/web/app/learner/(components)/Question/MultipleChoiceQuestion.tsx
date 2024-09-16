import { cn } from "@/lib/strings";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";

interface TrueFalseQuestionProps {
  isSingleCorrect: boolean; // New prop to control whether the question allows single or multiple correct answers
}

function TrueFalseQuestion({ isSingleCorrect }: TrueFalseQuestionProps) {
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

  const assignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id,
  );

  const handleChoiceClick = (choice: string) => {
    if (isSingleCorrect) {
      choices.forEach((c) => {
        // deselect all choices
        removeChoice(c.choice);
      });
      // select the clicked choice
      addChoice(choice);
    } else {
      // Multiple correct behavior: toggle the choice
      if (learnerChoices?.includes(choice)) {
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
        let bgColor = "";

        // Determine background color based on whether question is answered
        if (questionResponses.length) {
          if (learnerChoices?.includes(choiceText)) {
            if (isCorrect) {
              bgColor = "bg-green-100"; // Selected and correct
            } else {
              bgColor = "bg-red-100"; // Selected but incorrect
            }
          }
        } else {
          if (learnerChoices?.includes(choiceText)) {
            console.log("learnerChoices", learnerChoices);
            bgColor = "bg-blue-100"; // Selected but not answered yet
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
