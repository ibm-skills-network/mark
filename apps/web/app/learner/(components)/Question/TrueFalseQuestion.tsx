import { QuestionStore } from "@/config/types";
import { useLearnerStore } from "@/stores/learner";

interface Props {
  question: QuestionStore;
}

function TrueFalseQuestion(props: Props) {
  const { question } = props;
  const [setAnswerChoice] = useLearnerStore((state) => [state.setAnswerChoice]);
  const learnerAnswerChoice = question.learnerAnswerChoice;

  const handleChoiceClick = (choice: boolean) => {
    setAnswerChoice(choice, question.id);
  };

  const buttonStyle = (choice: boolean) => {
    if (learnerAnswerChoice === choice) {
      return "bg-blue-100 text-black"; // Highlight selected choice
    }
    return "text-black"; // Default style for unselected choice
  };

  return (
    <>
      <button
        className={`block w-full text-left p-2 mb-2 border rounded ${buttonStyle(
          true,
        )}`}
        onClick={() => handleChoiceClick(true)}
      >
        True
      </button>
      <button
        className={`block w-full text-left p-2 mb-2 border rounded ${buttonStyle(
          false,
        )}`}
        onClick={() => handleChoiceClick(false)}
      >
        False
      </button>
    </>
  );
}

export default TrueFalseQuestion;
