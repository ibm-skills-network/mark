"use client";

import TooltipMessage from "@/app/components/ToolTipMessage";
import { useChangesSummary } from "@/app/Helpers/checkDiff";
import Spinner from "@/components/svgs/Spinner";
import { useAuthorStore } from "@/stores/author";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEffect, useState, type FC } from "react";
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { handleScrollToFirstErrorField } from "@/app/Helpers/handleJumpToErrors";
import Tooltip from "@/components/Tooltip";
import { VersionSelectionModal } from "@/components/version-control/VersionSelectionModal";
import { VersionConflictModal } from "@/components/version-control/VersionConflictModal";
import { useVersionControl } from "@/hooks/useVersionControl";
import { VersionComparison } from "@/types/version-types";
import {
  SemanticVersion,
  VersionSuggestion,
  formatSemanticVersion,
  parseSemanticVersion,
  suggestNextVersion,
  analyzeChanges,
  getLatestVersion,
} from "@/lib/semantic-versioning";

interface Props {
  submitting: boolean;
  questionsAreReadyToBePublished: () => {
    isValid: boolean;
    message: string;
    step: number | null;
    invalidQuestionId: number;
  };
  handlePublishButton: (
    description?: string,
    publishImmediately?: boolean,
    versionNumber?: string,
  ) => void;
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
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [versionComparison, setVersionComparison] =
    useState<VersionComparison | null>(null);
  const [conflictDetails, setConflictDetails] = useState<{
    existingVersion: any;
    requestedVersion: string;
    description: string;
    isDraft: boolean;
  } | null>(null);

  const versionControlHook = useVersionControl();
  const {
    versions,
    currentVersion,
    compareVersions,
    createVersion,
    updateExistingVersion,
  } = versionControlHook;

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

    if (step !== null && step !== undefined) {
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
        router.push(`/author/${assignmentId}`);
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

  const handleButtonClick = async () => {
    if (disableButton && message !== "") {
      setShowErrorModal(true);
      return;
    }

    await handleCreateDraftImmediately();
  };

  const handleCreateDraftImmediately = async () => {
    try {
      const versionComparison = await generateVersionComparison();

      const recommendedVersion = getRecommendedDraftVersion(versionComparison);
      const defaultDescription = `Draft created on ${new Date().toLocaleString()}`;

      if (createVersion) {
        const result = await createVersion(
          defaultDescription,
          true,
          recommendedVersion,
          false,
        );

        if (result) {
          toast.success("Draft saved successfully!");

          router.push(`/author/${assignmentId}/version-tree`);
        } else {
          toast.error("Failed to save draft. Please try again.");
        }
      } else {
        throw new Error("createVersion function not available");
      }
    } catch (error: any) {
      console.error("Failed to create draft:", error);

      await handleShowVersionModal();
    }
  };

  const generateVersionComparison = async (): Promise<VersionComparison> => {
    if (!currentVersion) {
      return {
        fromVersion: {
          id: 0,
          versionNumber: "0.0.0",
          versionDescription: "Previous",
          isDraft: false,
          isActive: false,
          published: true,
          createdBy: "system",
          createdAt: new Date().toISOString(),
          questionCount: 0,
          wasAutoIncremented: false,
        },
        toVersion: {
          id: 1,
          versionNumber: "1.0.0",
          versionDescription: "New version",
          isDraft: false,
          isActive: true,
          published: false,
          createdBy: "system",
          createdAt: new Date().toISOString(),
          questionCount: 0,
          wasAutoIncremented: false,
        },
        assignmentChanges: [
          {
            field: "name",
            fromValue: null,
            toValue: "new assignment",
            changeType: "added",
          },
        ],

        questionChanges: [],
      };
    }

    return {
      fromVersion: {
        ...currentVersion,
        createdAt: currentVersion.createdAt,
        versionNumber: currentVersion.versionNumber?.toString(),
      },
      toVersion: {
        ...currentVersion,
        createdAt: currentVersion.createdAt,
        versionNumber: "next",
        versionDescription: "Updated version",
      },
      assignmentChanges: [
        {
          field: "instructions",
          fromValue: "previous",
          toValue: "updated",
          changeType: "modified",
        },
      ],

      questionChanges: [],
    };
  };

  const getRecommendedDraftVersion = (
    comparison: VersionComparison,
  ): string => {
    try {
      const latestVersion = getLatestVersion(versions);
      const currentVersionString = latestVersion
        ? formatSemanticVersion(latestVersion)
        : "1.0.0";

      const changeAnalysis = analyzeChanges(comparison);

      const suggestions = suggestNextVersion(
        currentVersionString,
        changeAnalysis,
        false,
      );

      if (suggestions.length > 0) {
        return formatSemanticVersion(suggestions[0]);
      }

      const current = parseSemanticVersion(currentVersionString);
      return formatSemanticVersion({
        ...current,
        patch: current.patch + 1,
      });
    } catch (error) {
      console.error("Error generating recommended version:", error);

      return "1.0.0";
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
    return { text: "Ready to create draft", type: "success" };
  };

  const statusMessage = getStatusMessage();

  const handleShowVersionModal = async () => {
    try {
      if (!currentVersion) {
        const defaultComparison: VersionComparison = {
          fromVersion: {
            id: 0,
            versionNumber: "0.0.0",
            versionDescription: "Previous",
            isDraft: false,
            isActive: false,
            published: true,
            createdBy: "system",
            createdAt: new Date().toISOString(),
            questionCount: 0,
            wasAutoIncremented: false,
          },
          toVersion: {
            id: 1,
            versionNumber: "1.0.0",
            versionDescription: "New version",
            isDraft: false,
            isActive: true,
            published: false,
            createdBy: "system",
            createdAt: new Date().toISOString(),
            questionCount: 0,
            wasAutoIncremented: false,
          },
          assignmentChanges: [
            {
              field: "name",
              fromValue: null,
              toValue: "new assignment",
              changeType: "added",
            },
          ],

          questionChanges: [],
        };
        setVersionComparison(defaultComparison);
        setShowVersionModal(true);
        return;
      }

      const defaultComparison: VersionComparison = {
        fromVersion: {
          ...currentVersion,
          createdAt: currentVersion.createdAt,
          versionNumber: currentVersion.versionNumber?.toString(),
        },
        toVersion: {
          ...currentVersion,
          createdAt: currentVersion.createdAt,
          versionNumber: "next",
          versionDescription: "Updated version",
        },
        assignmentChanges: [
          {
            field: "instructions",
            fromValue: "previous",
            toValue: "updated",
            changeType: "modified",
          },
        ],

        questionChanges: [],
      };
      setVersionComparison(defaultComparison);
      setShowVersionModal(true);
    } catch (error) {
      console.error("Failed to analyze changes:", error);

      const fallbackComparison: VersionComparison = {
        fromVersion: currentVersion
          ? {
              ...currentVersion,
              createdAt: currentVersion.createdAt,
              versionNumber: currentVersion.versionNumber?.toString(),
            }
          : {
              id: 0,
              versionNumber: "0.0.0",
              versionDescription: "Previous",
              isDraft: false,
              isActive: false,
              published: true,
              createdBy: "system",
              createdAt: new Date().toISOString(),
              questionCount: 0,
              wasAutoIncremented: false,
            },
        toVersion: {
          id: 1,
          versionNumber: "next",
          versionDescription: "Updated version",
          isDraft: false,
          isActive: true,
          published: false,
          createdBy: "system",
          createdAt: new Date().toISOString(),
          questionCount: 0,
          wasAutoIncremented: false,
        },
        assignmentChanges: [
          {
            field: "instructions",
            fromValue: "previous",
            toValue: "updated",
            changeType: "modified",
          },
        ],

        questionChanges: [],
      };
      setVersionComparison(fallbackComparison);
      setShowVersionModal(true);
    }
  };

  const handleVersionSave = async (
    versionNumber: string,
    description: string,
    isDraft: boolean,
    shouldUpdate?: boolean,
    versionId?: number,
  ) => {
    try {
      if (shouldUpdate && versionId) {
        if (updateExistingVersion) {
          await updateExistingVersion(
            versionId,
            versionNumber,
            description,
            true,
          );
          setShowVersionModal(false);

          router.push(`/author/${assignmentId}/version-tree`);
        } else {
          throw new Error("updateExistingVersion function not available");
        }
      } else if (createVersion) {
        await createVersion(description, true, versionNumber, shouldUpdate);
        setShowVersionModal(false);

        router.push(`/author/${assignmentId}/version-tree`);
      } else {
        console.error("createVersion function not available");
        throw new Error("createVersion function not available");
      }
    } catch (error: any) {
      console.error("Failed to save version:", error);

      if (
        error.response?.status === 409 &&
        error.response?.data?.versionExists
      ) {
        const conflictData = error.response.data;
        setConflictDetails({
          existingVersion: conflictData.existingVersion,
          requestedVersion: versionNumber,
          description,
          isDraft,
        });
        setShowVersionModal(false);
        setShowConflictModal(true);
        return;
      }

      throw error;
    }
  };

  const handleUpdateExistingVersion = async () => {
    if (!conflictDetails || !createVersion) return;

    try {
      await createVersion(
        conflictDetails.description,
        conflictDetails.isDraft,
        conflictDetails.requestedVersion,
        true,
      );

      setShowConflictModal(false);
      setConflictDetails(null);
    } catch (error) {
      console.error("Failed to update existing version:", error);
      throw error;
    }
  };

  const handleCreateNewVersion = () => {
    setShowConflictModal(false);
    setConflictDetails(null);

    setShowVersionModal(true);
  };

  useEffect(() => {
    if (!disableButton) {
      setShowErrorModal(false);
    }
  }, [disableButton]);

  return (
    <>
      <div className="space-y-3">
        <>
          <Tooltip
            content={
              statusMessage.text === "no changes detected."
                ? "No changes to create draft"
                : "Create a private draft immediately"
            }
            distance={-2.5}
            disabled={!disableButton || submitting}
          >
            <button
              type="button"
              disabled={disableButton}
              onClick={handleButtonClick}
              className="text-sm flex items-center justify-center px-3 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 text-violet-800 border-violet-100 bg-violet-50 hover:bg-violet-100 dark:text-violet-100 dark:border-violet-800 dark:bg-violet-900 dark:hover:bg-violet-950 disabled:opacity-50"
            >
              {submitting ? <Spinner className="w-5 h-5" /> : "Save as Draft"}
            </button>
          </Tooltip>
        </>
      </div>

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
                  submitting={submitting}
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

      <VersionSelectionModal
        isOpen={showVersionModal}
        onClose={() => setShowVersionModal(false)}
        onSave={handleVersionSave}
        currentVersions={versions.map((v) => ({
          versionNumber: v.versionNumber?.toString() || "0.0.0",
          id: v.id,
          isDraft: v.isDraft,
          isActive: v.isActive,
          published: v.published,
        }))}
        comparison={versionComparison}
        isLoading={submitting}
        workingVersion={
          currentVersion
            ? {
                versionNumber:
                  currentVersion.versionNumber?.toString() || "0.0.0",
                id: currentVersion.id,
                isDraft: currentVersion.isDraft,
                isActive: currentVersion.isActive,
                published: currentVersion.published,
              }
            : undefined
        }
      />

      {conflictDetails && (
        <VersionConflictModal
          isOpen={showConflictModal}
          onClose={() => {
            setShowConflictModal(false);
            setConflictDetails(null);
          }}
          onUpdate={handleUpdateExistingVersion}
          onCreateNew={handleCreateNewVersion}
          existingVersion={conflictDetails.existingVersion}
          requestedVersion={conflictDetails.requestedVersion}
        />
      )}
    </>
  );
};

export default SubmitQuestionsButton;
