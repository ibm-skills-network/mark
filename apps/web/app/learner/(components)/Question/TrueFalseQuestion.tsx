import { useLearnerStore } from "@/stores/learner";

interface Props {}

function TrueFalseQuestion(props: Props) {
  const {} = props;
  const activeQuestionNumber = useLearnerStore(
    (state) => state.activeQuestionNumber,
  );

  const [questions, setAnswerChoice] = useLearnerStore((state) => [
    state.questions,
    state.setAnswerChoice,
  ]);

  const { learnerAnswerChoice } = questions[activeQuestionNumber - 1];

  const handleChoiceClick = (choice: boolean) => {
    setAnswerChoice(choice, questions[activeQuestionNumber - 1].id);
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
