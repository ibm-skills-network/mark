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

  return (
    <div>
      <label className={`flex items-center w-full p-2 mb-2  rounded`}>
        <input
          type="radio"
          name={`question-${question.id}`}
          value="true"
          checked={learnerAnswerChoice === true}
          onChange={() => handleChoiceClick(true)}
          className="mr-2 accent-violet-600  text-violet-600"
        />
        True
      </label>
      <label className={`flex items-center w-full p-2 mb-2  rounded`}>
        <input
          type="radio"
          name={`question-${question.id}`}
          value="false"
          checked={learnerAnswerChoice === false}
          onChange={() => handleChoiceClick(false)}
          className="mr-2 accent-violet-600 text-violet-600"
        />
        False
      </label>
    </div>
  );
}

export default TrueFalseQuestion;
