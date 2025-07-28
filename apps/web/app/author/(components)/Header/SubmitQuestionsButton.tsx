"use client";

import TooltipMessage from "@/app/components/ToolTipMessage";
import { useChangesSummary } from "@/app/Helpers/checkDiff";
import Spinner from "@/components/svgs/Spinner";
import { useAuthorStore } from "@/stores/author";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FC } from "react";
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";
import Tooltip from "@/components/Tooltip";

interface Props {
  submitting: boolean;
  questionsAreReadyToBePublished: () => {
    isValid: boolean;
    message: string;
    step: number | null;
    invalidQuestionId: number;
  };
  handlePublishButton: () => void;
  currentStepId?: number;
}

const SubmitQuestionsButton: FC<Props> = ({
  submitting,
  questionsAreReadyToBePublished,
  handlePublishButton,
  currentStepId = 0,
}) => {
  const router = useRouter();
  const validateAssignmentSetup = useAuthorStore((state) => state.validate);
  const [showErrorModal, setShowErrorModal] = useState(false);

  const { isValid, message, step, invalidQuestionId } =
    questionsAreReadyToBePublished();
  const questions = useAuthorStore((state) => state.questions);
  const setFocusedQuestionId = useAuthorStore(
    (state) => state.setFocusedQuestionId,
  );
  const isLoading = !questions;
  const hasEmptyQuestion = questions?.some((q) => q.type === "EMPTY");
  const { assignmentId } = useAuthorStore((state) => ({
    assignmentId: state.activeAssignmentId,
  }));
  const changesSummary = useChangesSummary();
  const hasChanges = changesSummary !== "No changes detected.";
  const isLastStep = currentStepId === 3;

  const pageRouterUsingSteps = (step: number | null) => {
    console.log("pageRouterUsingSteps", step);
    switch (true) {
      case step === 0:
        return `/author/${assignmentId}/questions`;
      case step === 1:
        return `/author/${assignmentId}/config`;
      case step === 2:
        return `/author/${assignmentId}/review`;
      default:
        return `/author/${assignmentId}`;
    }
  };

  function handleNavigate() {
    setShowErrorModal(false);

    // Navigate first
    if (step !== null && step !== undefined) {
      console.log("navigating to step", step);
      const nextPage = pageRouterUsingSteps(step);
      console.log("nextPage", nextPage);

      if (nextPage) {
        console.log("pushing to nextPage", nextPage);
        router.push(nextPage);

        // If we have an invalidQuestionId, set it and scroll after navigation
        if (invalidQuestionId) {
          setFocusedQuestionId(invalidQuestionId);

          // Wait for navigation and rendering to complete
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
              // If question-title element doesn't exist, try the question element
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
          }, 500); // Give time for navigation and rendering
        }
      } else {
        router.push(`/author/${assignmentId}`);
      }
    } else if (invalidQuestionId) {
      // If no step but we have an invalid question ID, we're already on the right page
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

  const handleButtonClick = () => {
    if (disableButton && message !== "") {
      setShowErrorModal(true);
      return;
    }

    if (isLastStep) {
      handlePublishButton();
    } else {
      goToNextStep();
    }
  };

  const goToNextStep = () => {
    const isValid = validateAssignmentSetup();
    if (!isValid) {
      handleScrollToFirstErrorField();
      return;
    }
    const nextPage = pageRouterUsingSteps(currentStepId);
    console.log("currentStep", currentStepId);
    if (nextPage) {
      router.push(nextPage);
    } else {
      router.push(`/author/${assignmentId}`);
    }
  };

  const disableButton =
    submitting ||
    isLoading ||
    questions?.length === 0 ||
    hasEmptyQuestion ||
    !isValid ||
    !hasChanges;

  const getStatusMessage = () => {
    if (isLoading) return { text: "Loading questions...", type: "loading" };
    if (questions?.length === 0 && step === 2)
      return { text: "You need to add at least one question", type: "error" };
    if (hasEmptyQuestion)
      return { text: "Some questions have incomplete fields", type: "error" };
    if (!isValid) return { text: message, type: "error", hasAction: true };
    if (submitting)
      return { text: "Mark is analyzing your questions...", type: "loading" };
    if (!hasChanges) return { text: "No changes detected.", type: "warning" };
    return { text: "Ready to publish", type: "success" };
  };

  const statusMessage = getStatusMessage();

  // Hide modal when conditions change and button becomes enabled
  useEffect(() => {
    if (!disableButton) {
      setShowErrorModal(false);
    }
  }, [disableButton]);

  return (
    <>
      <div className="space-y-3">
        {/* Button */}
        {isLastStep ? (
          <>
            <Tooltip
              content={
                statusMessage.text === "no changes detected."
                  ? "No changes to save"
                  : "Review Your changes before publishing"
              }
              distance={-2.5}
              disabled={!disableButton || submitting}
            >
              <button
                type="button"
                disabled={disableButton}
                onClick={handleButtonClick}
                className="w-full text-sm font-medium flex items-center justify-center px-4 py-3 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none disabled:opacity-50 transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <Spinner className="w-5 h-5" />
                ) : (
                  "Save & Publish"
                )}
              </button>
            </Tooltip>
          </>
        ) : (
          <button
            onClick={handleButtonClick}
            className="w-full text-sm font-medium flex items-center justify-center px-4 py-3 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none disabled:opacity-50 transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800 disabled:cursor-not-allowed"
          >
            <span>Next</span>
            <ChevronRightIcon className="w-4 h-4 ml-2" />
          </button>
        )}
      </div>

      {/* Error Modal */}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
              onClick={() => setShowErrorModal(false)}
            />

            {/* Modal Content */}
            <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              {/* Close button */}
              <button
                onClick={() => setShowErrorModal(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>

              {/* Modal Header */}
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

              {/* Modal Body */}
              <div className="mb-6">
                <TooltipMessage
                  isLoading={isLoading}
                  questionsLength={questions?.length}
                  hasEmptyQuestion={hasEmptyQuestion}
                  isValid={isValid}
                  message={statusMessage.text}
                  submitting={submitting}
                  hasChanges={hasChanges}
                  changesSummary={changesSummary}
                  invalidQuestionId={invalidQuestionId}
                  onNavigate={handleNavigate}
                  showAction={false} // No action button in modal
                />
              </div>

              {/* Modal Footer */}
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

export default SubmitQuestionsButton;
