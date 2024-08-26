import Spinner from "@/components/svgs/Spinner";
import Tooltip from "@/components/Tooltip";
import { useAuthorStore } from "@/stores/author";
import type { ComponentPropsWithoutRef, FC } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  submitting: boolean;
  questionsAreReadyToBePublished: boolean;
  handlePublishButton: () => void;
}

const Component: FC<Props> = (props) => {
  const { submitting, questionsAreReadyToBePublished, handlePublishButton } =
    props;
  const questions = useAuthorStore((state) => state.questions);
  const hasEmptyQuestion = questions?.some(
    (question) => question.type === "EMPTY",
  ); // disable button if there is an empty question Type
  const disableButton =
    !questionsAreReadyToBePublished ||
    submitting ||
    questions?.length === 0 ||
    hasEmptyQuestion;
  let tooltipMessage = "";
  if (questions?.length === 0) {
    tooltipMessage = "You need to add at least one question";
  } else if (hasEmptyQuestion) {
    tooltipMessage = "Some questions have incomplete fields";
  } else if (!questionsAreReadyToBePublished) {
    tooltipMessage = "Some questions have incomplete fields";
  } else if (submitting) {
    tooltipMessage = "Mark is analyzing your questions...";
  }

  return (
    <Tooltip disabled={!disableButton} content={tooltipMessage} distance={-2}>
      <button
        type="button"
        disabled={disableButton}
        onClick={handlePublishButton}
        className="inline-flex transition-all leading-6 items-center px-4 py-2 border border-transparent font-medium rounded-md text-white bg-blue-700 enabled:hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50"
      >
        {submitting ? <Spinner className="w-8" /> : "Save & Publish"}
      </button>
    </Tooltip>
  );
};

export default Component;
