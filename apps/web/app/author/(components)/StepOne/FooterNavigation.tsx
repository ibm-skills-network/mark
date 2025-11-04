"use client";

import { useQuestionsAreReadyToBePublished } from "@/app/Helpers/checkQuestionsReady";
import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";
import Button from "@/components/Button";
import TooltipMessage from "@/app/components/ToolTipMessage";
import { useChangesSummary } from "@/app/Helpers/checkDiff";
import { Question } from "@/config/types";
import { useAuthorStore } from "@/stores/author";
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";

interface Props extends ComponentPropsWithoutRef<"nav"> {
  assignmentId?: string;
  nextStep?: string;
  currentStepId?: number;
}

export const FooterNavigation: FC<Props> = ({
  assignmentId,
  nextStep = "config",
  currentStepId = 1,
}) => {
  const router = useRouter();
  const [activeAssignmentId, questions] = useAuthorStore((state) => [
    state.activeAssignmentId,
    state.questions,
  ]);
  const setFocusedQuestionId = useAuthorStore(
    (state) => state.setFocusedQuestionId,
  );
  const [showErrorModal, setShowErrorModal] = useState(false);
  const validateAssignmentSetup = useAuthorStore((state) => state.validate);
  const questionsAreReadyToBePublished = useQuestionsAreReadyToBePublished(
    questions as Question[],
  );
  const changesSummary = useChangesSummary();
  const hasChanges = changesSummary !== "No changes detected.";

  const isLoading = !questions;
  const hasEmptyQuestion = questions?.some((q) => q.type === "EMPTY");

  const { isValid, message, step, invalidQuestionId } =
    questionsAreReadyToBePublished();

  const pageRouterUsingSteps = (step: number | null) => {
    switch (true) {
      case step === 0:
        return `/author/${activeAssignmentId}/questions`;
      case step === 1:
        return `/author/${activeAssignmentId}/config`;
      case step === 2:
        return `/author/${activeAssignmentId}/review`;
      default:
        return `/author/${activeAssignmentId}`;
    }
  };

  function handleNavigate() {
    setShowErrorModal(false);

    if (step !== null && step !== undefined && step !== currentStepId) {
      const nextPage = pageRouterUsingSteps(step);

      if (nextPage) {
        router.push(nextPage);

        if (invalidQuestionId) {
          setFocusedQuestionId(invalidQuestionId);

          setTimeout(() => {
            const element = document.getElementById(
              `question-title-${invalidQuestionId}`,
            );
            if (element) {
              element.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "center",
              });
            } else {
              const questionElement = document.getElementById(
                `question-${invalidQuestionId}`,
              );
              if (questionElement) {
                questionElement.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                  inline: "nearest",
                });
              }
            }
          }, 500);
        }
      } else {
        router.push(`/author/${activeAssignmentId}`);
      }
    } else if (invalidQuestionId) {
      setFocusedQuestionId(invalidQuestionId);

      setTimeout(() => {
        const element = document.getElementById(
          `question-title-${invalidQuestionId}`,
        );
        if (element) {
          element.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center",
          });
        }
      }, 100);
    }
  }

  const goToNextStep = () => {
    const isValidSetup = validateAssignmentSetup();

    if (!isValidSetup) {
      handleScrollToFirstErrorField();
      return;
    }

    if (!isValid) {
      if (step !== null && step !== undefined && step !== currentStepId) {
        setShowErrorModal(true);
      } else {
        handleNavigate();
      }
      return;
    }
    router.push(`/author/${activeAssignmentId}/${nextStep}`);
  };

  const getStatusMessage = () => {
    if (isLoading) return { text: "Loading questions...", type: "loading" };
    if (questions?.length === 0 && step === 2)
      return { text: "You need to add at least one question", type: "error" };
    if (hasEmptyQuestion)
      return { text: "Some questions have incomplete fields", type: "error" };
    if (!isValid)
      return {
        text: message,
        type: "error",
        hasAction: step !== currentStepId,
      };
    if (!hasChanges) return { text: "No changes detected.", type: "warning" };
    return { text: "Ready to continue", type: "success" };
  };

  const statusMessage = getStatusMessage();

  return (
    <>
      <footer className="flex gap-5 justify-end max-w-full text-base font-medium leading-6 text-violet-800 whitespace-nowrap max-md:flex-wrap">
        <Button
          version="secondary"
          RightIcon={ChevronRightIcon}
          onClick={goToNextStep}
        >
          Next
        </Button>
      </footer>

      {showErrorModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div
              className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
              onClick={() => setShowErrorModal(false)}
            />

            <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <button
                onClick={() => setShowErrorModal(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>

              <div className="flex items-center mb-4">
                {statusMessage.type === "error" && (
                  <ExclamationTriangleIcon className="h-6 w-6 text-red-500 mr-2" />
                )}
                {statusMessage.type === "warning" && (
                  <ExclamationTriangleIcon className="h-6 w-6 text-yellow-500 mr-2" />
                )}
                <h3 className="text-lg font-semibold text-gray-900">
                  {statusMessage.type === "error" ? "Error" : "Warning"}
                </h3>
              </div>

              <div className="mb-6">
                <TooltipMessage
                  isLoading={isLoading}
                  questionsLength={questions?.length}
                  hasEmptyQuestion={hasEmptyQuestion}
                  isValid={isValid}
                  message={statusMessage.text}
                  submitting={false}
                  hasChanges={hasChanges}
                  changesSummary={changesSummary}
                  invalidQuestionId={invalidQuestionId}
                  onNavigate={handleNavigate}
                  showAction={false}
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowErrorModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
                >
                  Close
                </button>
                {statusMessage.hasAction && (
                  <button
                    onClick={handleNavigate}
                    className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
                  >
                    Take me there
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
