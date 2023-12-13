import Spinner from "@/components/svgs/Spinner";
import Tooltip from "@/components/Tooltip";
import { QuestionStore } from "@/config/types";
import { getWordCount } from "@/lib/utils";
import { type ComponentPropsWithoutRef, type FC } from "react";
import Button from "../Button";
import { useLearnerStore } from "@/stores/learner";

interface Props extends ComponentPropsWithoutRef<"div"> {
  question: QuestionStore;
  submitting: boolean;
  attemptsRemaining: number;
  handleSubmit: () => void;
}

const Component: FC<Props> = (props) => {
  const { question, submitting, attemptsRemaining, handleSubmit } = props;

  const noMoreAttempts = attemptsRemaining === 0;
  const invalidTextResponse =
    question.learnerTextResponse &&
    (question.learnerTextResponse.length === 0 ||
      getWordCount(question.learnerTextResponse) > question.maxWords);
  const invalidUrlResponse =
    question.learnerUrlResponse && question.learnerUrlResponse.length === 0;

  const disableSubmission =
    submitting || noMoreAttempts || invalidTextResponse || invalidUrlResponse;

  const tooltipContent =
    (noMoreAttempts &&
      "You have no more attempts remaining for this question.") ||
    (invalidTextResponse &&
      `Your response must be between 1 and ${question.maxWords} words.`) ||
    (invalidUrlResponse && "Please enter a valid URL.") ||
    "";

  return (
    <Tooltip
      content={tooltipContent}
      disabled={!disableSubmission || !tooltipContent}
      distance={-2}
    >
      <Button
        disabled={disableSubmission}
        className="disabled:opacity-50 transition-all"
        onClick={handleSubmit}
      >
        {submitting ? <Spinner className="w-7 h-7" /> : "Submit Response"}
      </Button>
    </Tooltip>
  );
};

export default Component;
