import { trueFalseTranslations } from "@/app/Helpers/Languages/TrueFalseInAllLang";
import { QuestionStore } from "@/config/types";
import { useLearnerStore, useLearnerOverviewStore } from "@/stores/learner";
import { useAutoSaveResponse } from "@/hooks/use-auto-save-response";

interface Props {
  question: QuestionStore;
}

function TrueFalseQuestion(props: Props) {
  const { question } = props;
  const [setAnswerChoice, activeAttemptId] = useLearnerStore((state) => [
    state.setAnswerChoice,
    state.activeAttemptId,
  ]);
  const assignmentId = useLearnerOverviewStore((state) => state.assignmentId);
  const learnerAnswerChoice = question.learnerAnswerChoice;

  const userPreferredLanguage =
    useLearnerStore((state) => state.userPreferedLanguage) || "en";
  const langTranslations =
    trueFalseTranslations[userPreferredLanguage] || trueFalseTranslations["en"];

  // useAutoSaveResponse(assignmentId, activeAttemptId, question.id, {
  //   enabled: true,
  //   debounceMs: 500,
  // });

  const handleChoiceClick = (choice: boolean) => {
    setAnswerChoice(choice, question.id);
  };

  return (
    <div>
      <label className="flex items-center w-full p-2 mb-2 rounded">
        <input
          type="radio"
          name={`question-${question.id}`}
          value="true"
          checked={learnerAnswerChoice === true}
          onChange={() => handleChoiceClick(true)}
          className="mr-2 accent-violet-600 text-violet-600"
        />

        {langTranslations.true}
      </label>
      <label className="flex items-center w-full p-2 mb-2 rounded">
        <input
          type="radio"
          name={`question-${question.id}`}
          value="false"
          checked={learnerAnswerChoice === false}
          onChange={() => handleChoiceClick(false)}
          className="mr-2 accent-violet-600 text-violet-600"
        />

        {langTranslations.false}
      </label>
    </div>
  );
}

export default TrueFalseQuestion;
