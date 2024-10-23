"use client";
import Button from "@/components/Button";
import { publishStepOneData } from "@/lib/sendZustandDataToBackend";
import { useAuthorStore } from "@/stores/author";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";
import { useQuestionsAreReadyToBePublished } from "@/app/Helpers/checkQuestionsReady";
import { Question } from "@/config/types";
import Tooltip from "@/components/Tooltip";
import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";
interface Props extends ComponentPropsWithoutRef<"nav"> {
  assignmentId?: string;
  nextStep?: string;
}

export const FooterNavigation: FC<Props> = ({
  assignmentId,
  nextStep = "config",
}) => {
  const router = useRouter();
  const [activeAssignmentId, questions] = useAuthorStore((state) => [
    state.activeAssignmentId,
    state.questions,
  ]);
  const setFocusedQuestionId = useAuthorStore(
    (state) => state.setFocusedQuestionId,
  );
  const [tooltipMessage, setTooltipMessage] = useState<React.ReactNode>("");
  const validateAssignmentSetup = useAuthorStore((state) => state.validate);
  const [disableButton, setDisableButton] = useState<boolean>(false);
  const questionsAreReadyToBePublished = useQuestionsAreReadyToBePublished(
    questions as Question[],
  );
  const goToNextStep = async () => {
    const isValid = validateAssignmentSetup();
    if (!isValid) {
      handleScrollToFirstErrorField();
      return;
    }
    router.push(`/author/${activeAssignmentId}/${nextStep}`);
    await publishStepOneData();
  };
  useEffect(() => {
    const { isValid, message, invalidQuestionId } =
      questionsAreReadyToBePublished();
    setDisableButton(!isValid);
    setTooltipMessage(
      <>
        <span>{message}</span>
        {!isValid && (
          <button
            onClick={() => {
              setFocusedQuestionId(invalidQuestionId);
              handleScrollToFirstErrorField();
            }}
            className="ml-2 text-blue-500 hover:underline"
          >
            Take me there
          </button>
        )}
      </>,
    );
  }, [questions]);

  return (
    <footer className="flex gap-5 justify-end max-w-full text-base font-medium leading-6 text-violet-800 whitespace-nowrap max-md:flex-wrap">
      <Tooltip disabled={!disableButton} content={tooltipMessage} distance={3}>
        <Button
          version="secondary"
          RightIcon={ChevronRightIcon}
          onClick={goToNextStep}
        >
          Next
        </Button>
      </Tooltip>
    </footer>
  );
};
