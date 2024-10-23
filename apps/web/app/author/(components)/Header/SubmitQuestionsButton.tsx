import { handleJumpToQuestion } from "@/app/Helpers/handleJumpToQuestion";
import Spinner from "@/components/svgs/Spinner";
import Tooltip from "@/components/Tooltip";
import { useAuthorStore } from "@/stores/author";
import type { FC } from "react";

interface Props {
  submitting: boolean;
  questionsAreReadyToBePublished: () => {
    isValid: boolean;
    message: string;
    invalidQuestionId: number;
  };
  handlePublishButton: () => void;
}

const SubmitQuestionsButton: FC<Props> = ({
  submitting,
  questionsAreReadyToBePublished,
  handlePublishButton,
}) => {
  const { isValid, message, invalidQuestionId } =
    questionsAreReadyToBePublished();
  const questions = useAuthorStore((state) => state.questions);
  const setFocusedQuestionId = useAuthorStore(
    (state) => state.setFocusedQuestionId,
  );

  const isLoading = !questions;

  const hasEmptyQuestion = questions?.some(
    (question) => question.type === "EMPTY",
  );

  const disableButton =
    submitting ||
    isLoading ||
    questions?.length === 0 ||
    hasEmptyQuestion ||
    !isValid;

  let tooltipMessage: React.ReactNode = "";
  if (isLoading) {
    tooltipMessage = "Loading questions...";
  } else if (questions?.length === 0) {
    tooltipMessage = "You need to add at least one question";
  } else if (hasEmptyQuestion) {
    tooltipMessage = "Some questions have incomplete fields";
  } else if (!isValid) {
    tooltipMessage = (
      <>
        <span>{message}</span>
        {!isValid && (
          <button
            onClick={() => {
              setFocusedQuestionId(invalidQuestionId);
              handleJumpToQuestion(`indexQuestion-${invalidQuestionId}`);
            }}
            className="ml-2 text-blue-500 hover:underline"
          >
            Take me there
          </button>
        )}
      </>
    );
  } else if (submitting) {
    tooltipMessage = "Mark is analyzing your questions...";
  }

  return (
    <Tooltip disabled={!disableButton} content={tooltipMessage} distance={-2}>
      <button
        type="button"
        disabled={disableButton}
        onClick={handlePublishButton}
        className="text-sm font-medium items-center justify-center px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none disabled:opacity-50 transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800"
      >
        {submitting ? <Spinner className="w-5 h-5" /> : "Save & Publish"}
      </button>
    </Tooltip>
  );
};

export default SubmitQuestionsButton;
