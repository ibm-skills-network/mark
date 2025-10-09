"use client";

import CheckLearnerSideButton from "@/app/author/(components)/Header/CheckLearnerSideButton";
import { useMarkChatStore } from "@/app/chatbot/store/useMarkChatStore";
import { useChangesSummary } from "@/app/Helpers/checkDiff";
import { useChatbot } from "@/hooks/useChatbot";
import { decodeFields } from "@/app/Helpers/decoder";
import { encodeFields } from "@/app/Helpers/encoder";
import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import { stripHtml } from "@/app/Helpers/strippers";
import Modal from "@/components/Modal";
import ProgressBar, { JobStatus } from "@/components/ProgressBar";
import Tooltip from "@/components/Tooltip";
import {
  Assignment,
  Choice,
  Criteria,
  Question,
  QuestionAuthorStore,
  QuestionVariants,
  ReplaceAssignmentRequest,
} from "@/config/types";
import { extractAssignmentId } from "@/lib/strings";
import {
  getAssignment,
  getUser,
  publishAssignment,
  subscribeToJobStatus,
} from "@/lib/talkToBackend";
import { mergeData } from "@/lib/utils";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuestionsAreReadyToBePublished } from "../../../Helpers/checkQuestionsReady";
import { Nav } from "./Nav";
import SubmitQuestionsButton from "./SubmitQuestionsButton";
import SaveAndPublishButton from "./SaveAndPublishButton";

function maybeDecodeString(str: string | null | undefined): string | null {
  if (!str) return str;
  try {
    return atob(str);
  } catch {
    return str;
  }
}

function fixScoringAndDecode(assignment: Assignment): Assignment {
  if (!assignment || !assignment.questions) return assignment;

  assignment.questions.forEach((q: Question) => {
    if (q.scoring && q.scoring.criteria) {
      q.scoring.rubrics = [
        {
          rubricQuestion: q.question,
          criteria: q.scoring.criteria,
        },
      ];
      delete q.scoring.criteria;
    }

    q.question = maybeDecodeString(q.question);
    q.variants.forEach((variant: QuestionVariants) => {
      if (variant.scoring && variant.scoring.criteria) {
        variant.variantContent = maybeDecodeString(variant.variantContent);
        variant.scoring.rubrics = [
          {
            rubricQuestion: variant.variantContent,
            criteria: variant.scoring.criteria.map((crit: Criteria, idx) => ({
              description: crit.description,
              points: crit.points,
              id: idx + 1,
            })),
          },
        ];
        delete variant.scoring.criteria;
      }
    });
  });
  return assignment;
}

function AuthorHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { isOpen: isChatbotOpen } = useChatbot();
  const assignmentId = extractAssignmentId(pathname);
  const [currentStepId, setCurrentStepId] = useState<number>(0);
  const setQuestions = useAuthorStore((state) => state.setQuestions);
  const setUserRole = useMarkChatStore((s) => s.setUserRole);
  useEffect(() => {
    setUserRole("author");
  }, [setUserRole]);
  const [
    setActiveAssignmentId,
    questions,
    setPageState,
    setAuthorStore,
    activeAssignmentId,
    name,
  ] = useAuthorStore((state) => [
    state.setActiveAssignmentId,
    state.questions,
    state.setPageState,
    state.setAuthorStore,
    state.activeAssignmentId,
    state.name,
  ]);

  const loadVersions = useAuthorStore((state) => state.loadVersions);
  const questionsAreReadyToBePublished = useQuestionsAreReadyToBePublished(
    questions as Question[],
  );
  const [setAssignmentConfigStore] = useAssignmentConfig((state) => [
    state.setAssignmentConfigStore,
  ]);
  const [setAssignmentFeedbackConfigStore] = useAssignmentFeedbackConfig(
    (state) => [state.setAssignmentFeedbackConfigStore],
  );
  const [
    introduction,
    instructions,
    gradingCriteriaOverview,
    questionOrder,
    originalAssignment,
  ] = useAuthorStore((state) => [
    state.introduction,
    state.instructions,
    state.gradingCriteriaOverview,
    state.questionOrder,
    state.originalAssignment,
  ]);
  const [
    numAttempts,
    retakeAttemptCoolDownMinutes,
    attemptsBeforeCoolDown,
    passingGrade,
    displayOrder,
    graded,
    questionDisplay,
    timeEstimateMinutes,
    allotedTimeMinutes,
    updatedAt,
    numberOfQuestionsPerAttempt,
  ] = useAssignmentConfig((state) => [
    state.numAttempts,
    state.retakeAttemptCoolDownMinutes,
    state.attemptsBeforeCoolDown,
    state.passingGrade,
    state.displayOrder,
    state.graded,
    state.questionDisplay,
    state.timeEstimateMinutes,
    state.allotedTimeMinutes,
    state.updatedAt,
    state.numberOfQuestionsPerAttempt,
  ]);
  const [
    showSubmissionFeedback,
    showQuestionScore,
    showAssignmentScore,
    showQuestions,
    correctAnswerVisibility,
  ] = useAssignmentFeedbackConfig((state) => [
    state.showSubmissionFeedback,
    state.showQuestionScore,
    state.showAssignmentScore,
    state.showQuestions,
    state.correctAnswerVisibility,
  ]);
  const role = useAuthorStore((state) => state.role);

  const [showAreYouSureModal, setShowAreYouSureModal] =
    useState<boolean>(false);
  const [showDraftModal, setShowDraftModal] = useState<boolean>(false);
  const [draftName, setDraftName] = useState<string>("");

  const deleteAuthorStore = useAuthorStore((state) => state.deleteStore);
  const deleteAssignmentConfigStore = useAssignmentConfig(
    (state) => state.deleteStore,
  );
  const deleteAssignmentFeedbackConfigStore = useAssignmentFeedbackConfig(
    (state) => state.deleteStore,
  );
  const changesSummary = useChangesSummary();

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [currentMessage, setCurrentMessage] = useState<string>(
    "Initializing publishing...",
  );
  const [progressStatus, setProgressStatus] =
    useState<JobStatus>("In Progress");

  const SyncAssignment = async () => {
    try {
      const assignment = await getAssignment(parseInt(assignmentId, 10));
      if (!assignment) {
        toast.error("Failed to fetch the assignment.");
        return;
      }
      const decodedFields = decodeFields({
        introduction: assignment.introduction,
        instructions: assignment.instructions,
        gradingCriteriaOverview: assignment.gradingCriteriaOverview,
      });

      const decodedAssignment = {
        ...assignment,
        ...decodedFields,
      };

      const newAssignment = fixScoringAndDecode(decodedAssignment);
      const questions: QuestionAuthorStore[] =
        newAssignment.questions?.map(
          (question: QuestionAuthorStore, index: number) => {
            const parsedVariants: QuestionVariants[] =
              question.variants?.map((variant: QuestionVariants) => ({
                ...variant,
                choices:
                  typeof variant.choices === "string"
                    ? (JSON.parse(variant.choices) as Choice[])
                    : variant.choices,
              })) || [];

            const rubricArray = question.scoring?.rubrics?.map((rubric) => {
              return {
                rubricQuestion: stripHtml(rubric.rubricQuestion),
                criteria: rubric.criteria.map((crit, idx) => {
                  return {
                    description: crit.description,
                    points: crit.points,
                    id: idx + 1,
                  };
                }),
              };
            });

            return {
              ...question,
              alreadyInBackend: true,
              variants: parsedVariants,
              scoring: {
                type: "CRITERIA_BASED",
                rubrics: rubricArray || [],
              },
              index: index + 1,
            };
          },
        ) || [];

      newAssignment.questions = questions;

      useAuthorStore.getState().setOriginalAssignment(newAssignment);
      useAuthorStore.getState().setAuthorStore(newAssignment);

      useAssignmentConfig.getState().setAssignmentConfigStore({
        numAttempts: newAssignment.numAttempts,
        retakeAttemptCoolDownMinutes:
          newAssignment.retakeAttemptCoolDownMinutes,
        attemptsBeforeCoolDown: newAssignment.attemptsBeforeCoolDown,
        passingGrade: newAssignment.passingGrade,
        displayOrder: newAssignment.displayOrder,
        graded: newAssignment.graded,
        questionDisplay: newAssignment.questionDisplay,
        timeEstimateMinutes: newAssignment.timeEstimateMinutes,
        allotedTimeMinutes: newAssignment.allotedTimeMinutes,
        updatedAt: newAssignment.updatedAt,
        showQuestions: newAssignment.showQuestions,
        showSubmissionFeedback: newAssignment.showSubmissionFeedback,
      });

      if (newAssignment.questionVariationNumber !== undefined) {
        setAssignmentConfigStore({
          questionVariationNumber: newAssignment.questionVariationNumber,
        });
      }

      useAssignmentFeedbackConfig.getState().setAssignmentFeedbackConfigStore({
        showSubmissionFeedback: newAssignment.showSubmissionFeedback,
        showQuestionScore: newAssignment.showQuestionScore,
        showAssignmentScore: newAssignment.showAssignmentScore,
        correctAnswerVisibility: newAssignment.correctAnswerVisibility,
      });

      useAuthorStore.getState().setName(newAssignment.name);
      useAuthorStore.getState().setActiveAssignmentId(newAssignment.id);

      setPageState("success");
    } catch (error) {
      setPageState("error");
    }
  };

  const fetchAssignment = async () => {
    // For now, just load the regular assignment
    // TODO: Re-enable draft loading once basic version control is working
    const assignment = await getAssignment(parseInt(assignmentId, 10));
    if (assignment) {
      const decodedFields = decodeFields({
        introduction: assignment.introduction,
        instructions: assignment.instructions,
        gradingCriteriaOverview: assignment.gradingCriteriaOverview,
      });

      const decodedAssignment = {
        ...assignment,
        ...decodedFields,
      };

      const newAssignment = fixScoringAndDecode(decodedAssignment);

      useAuthorStore.getState().setOriginalAssignment(newAssignment);

      const mergedAuthorData = mergeData(
        useAuthorStore.getState(),
        newAssignment,
      );
      const { updatedAt, ...cleanedAuthorData } = mergedAuthorData;
      setAuthorStore({
        ...cleanedAuthorData,
      });

      const mergedAssignmentConfigData = mergeData(
        useAssignmentConfig.getState(),
        newAssignment,
      );
      if (newAssignment.questionVariationNumber !== undefined) {
        setAssignmentConfigStore({
          questionVariationNumber: newAssignment.questionVariationNumber,
        });
      }
      const {
        updatedAt: authorStoreUpdatedAt,
        ...cleanedAssignmentConfigData
      } = mergedAssignmentConfigData;
      setAssignmentConfigStore({
        ...cleanedAssignmentConfigData,
      });

      const mergedAssignmentFeedbackData = mergeData(
        useAssignmentFeedbackConfig.getState(),
        newAssignment,
      );
      const {
        updatedAt: assignmentFeedbackUpdatedAt,
        ...cleanedAssignmentFeedbackData
      } = mergedAssignmentFeedbackData;
      setAssignmentFeedbackConfigStore({
        ...cleanedAssignmentFeedbackData,
      });

      useAuthorStore.getState().setName(newAssignment.name);
      setPageState("success");
    } else {
      setPageState("error");
    }
  };

  const getUserRole = async () => {
    const user = await getUser();
    if (user) {
      useAuthorStore.getState().setRole(user.role);
    }
    return user?.role;
  };

  useEffect(() => {
    const fetchData = async () => {
      setActiveAssignmentId(~~assignmentId);
      const role = await getUserRole();
      if (role === "author") {
        void fetchAssignment();
      } else {
        toast.error(
          "You are not in author mode. Please switch to author mode by relaunching the assignment to publish this assignment.",
        );
      }
    };

    void fetchData();
  }, [assignmentId, router]);

  // Listen for draft activation publishing events from VersionTreeView
  useEffect(() => {
    const handleTriggerHeaderPublish = (event: any) => {
      const {
        description,
        publishImmediately,
        versionNumber,
        updateExisting,
        afterPublish,
      } = event.detail;

      // Store the afterPublish callback for later use
      const originalAfterPublish = afterPublish;

      // Call handlePublishButton with the provided parameters
      handlePublishButton(description, publishImmediately)
        .then(() => {
          // After successful publishing, execute the callback if provided
          if (
            originalAfterPublish &&
            typeof originalAfterPublish === "function"
          ) {
            originalAfterPublish();
          }
        })
        .catch((error) => {
          console.error("Header publishing failed:", error);
          toast.error("Failed to publish version through header");
        });
    };

    window.addEventListener("triggerHeaderPublish", handleTriggerHeaderPublish);

    return () => {
      window.removeEventListener(
        "triggerHeaderPublish",
        handleTriggerHeaderPublish,
      );
    };
  }, [handlePublishButton]);

  function calculateTotalPoints(questions: QuestionAuthorStore[]) {
    return questions.map((question: QuestionAuthorStore) => {
      const totalPoints = question.scoring?.rubrics
        ? question.scoring.rubrics.reduce(
            (sum, rubric) =>
              sum +
              Math.max(...rubric.criteria.map((crit) => crit.points || 0)),
            0,
          )
        : 0;
      return {
        ...question,
        totalPoints,
      };
    });
  }

  async function handlePublishButton(
    description?: string,
    publishImmediately = true,
    versionNumber?: string,
  ): Promise<void> {
    setSubmitting(true);
    setJobProgress(0);
    setCurrentMessage(
      publishImmediately ? "Initializing publishing..." : "Creating version...",
    );
    setProgressStatus("In Progress");

    const role = await getUserRole();
    if (role !== "author") {
      toast.error(
        "You are not in author mode. Please switch to author mode by relaunching the assignment to publish this assignment.",
      );
      setSubmitting(false);
      return;
    }

    let clonedCurrentQuestions = JSON.parse(
      JSON.stringify(questions),
    ) as QuestionAuthorStore[];
    const clonedOriginalQuestions = JSON.parse(
      JSON.stringify(originalAssignment.questions),
    ) as QuestionAuthorStore[];

    function removeEphemeralFields(questionArray: QuestionAuthorStore[]) {
      questionArray.forEach((q) => {
        delete q.alreadyInBackend;
        if (q.type !== "MULTIPLE_CORRECT" && q.type !== "SINGLE_CORRECT") {
          delete q.randomizedChoices;
        }
        if (q.responseType !== "PRESENTATION") {
          delete q.videoPresentationConfig;
        }
        if (q.responseType !== "LIVE_RECORDING") {
          delete q.liveRecordingConfig;
        }
      });
    }
    removeEphemeralFields(clonedCurrentQuestions);
    removeEphemeralFields(clonedOriginalQuestions);

    clonedCurrentQuestions = calculateTotalPoints(clonedCurrentQuestions);

    const questionsAreDifferent =
      JSON.stringify(clonedCurrentQuestions) !==
      JSON.stringify(clonedOriginalQuestions);

    const encodedFields = encodeFields({
      introduction,
      instructions,
      gradingCriteriaOverview,
    }) as {
      introduction: string;
      instructions: string;
      gradingCriteriaOverview: string;
    } & { [key: string]: string | null };

    const assignmentData: ReplaceAssignmentRequest = {
      ...encodedFields,
      numAttempts,
      retakeAttemptCoolDownMinutes,
      attemptsBeforeCoolDown,
      passingGrade,
      displayOrder,
      graded,
      questionDisplay,
      allotedTimeMinutes: allotedTimeMinutes || null,
      updatedAt,
      questionOrder,
      timeEstimateMinutes: timeEstimateMinutes,
      published: publishImmediately,
      showSubmissionFeedback,
      showQuestions,
      showQuestionScore,
      showAssignmentScore,
      correctAnswerVisibility,
      numberOfQuestionsPerAttempt,
      questions: questionsAreDifferent
        ? processQuestions(clonedCurrentQuestions)
        : null,
      versionDescription: description,
      versionNumber: versionNumber,
    };
    if (assignmentData.introduction === null) {
      toast.error(
        publishImmediately
          ? "Introduction is required to publish the assignment."
          : "Introduction is required to create a version.",
      );
      setSubmitting(false);
      return;
    }
    try {
      const response = await publishAssignment(
        activeAssignmentId,
        assignmentData,
      );
      if (response?.jobId) {
        await subscribeToJobStatus(
          response.jobId,
          (percentage, progress) => {
            setJobProgress(percentage);
            setCurrentMessage(progress);
            setQuestions(clonedCurrentQuestions);
          },
          setQuestions,
        );
        if (publishImmediately) {
          toast.success("Questions published successfully!");
        } else {
          toast.success("Version saved successfully!");
        }
        setProgressStatus("Completed");

        // Reload versions to reflect the new version
        try {
          await loadVersions();
        } catch (error) {
          console.error("Failed to reload versions after publish:", error);
        }
      } else {
        toast.error(
          publishImmediately
            ? "Failed to start the publishing process. Please try again."
            : "Failed to create version. Please try again.",
        );
        setProgressStatus("Failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast.error(
          publishImmediately
            ? `Error during publishing: ${error.message}`
            : `Error creating version: ${error.message}`,
        );
      } else {
        toast.error(
          publishImmediately
            ? "An unknown error occurred during publishing."
            : "An unknown error occurred while creating version.",
        );
      }
      setProgressStatus("Failed");
    } finally {
      setSubmitting(false);
    }
  }

  const handleSyncWithLatestPublishedVersion = async () => {
    if (changesSummary !== "No changes detected.") {
      setShowAreYouSureModal(true);
      return;
    } else {
      await SyncAssignment();
      toast.success("Synced with latest published version.");
    }
  };

  const handleConfirmSync = async () => {
    deleteAuthorStore();
    deleteAssignmentConfigStore();
    deleteAssignmentFeedbackConfigStore();
    await SyncAssignment();
    setShowAreYouSureModal(false);
    toast.success("Synced with latest published version.");
  };

  const handleSaveChanges = async (
    customDraftName?: string,
  ): Promise<boolean> => {
    if (!activeAssignmentId) {
      toast.error("No assignment selected");
      return false;
    }

    try {
      const { saveDraft } = await import("@/lib/author");
      const draftData = {
        draftName:
          customDraftName || `Manual save - ${new Date().toLocaleString()}`,
        assignmentData: {
          name,
          introduction,
          instructions,
          gradingCriteriaOverview,
        },
        questionsData: questions,
      };

      const result = await saveDraft(activeAssignmentId, draftData);
      return !!result;
    } catch (error) {
      console.error("Save error:", error);
      return false;
    }
  };

  const handleConfirmSaveDraft = async () => {
    setShowDraftModal(false);
    const success = await handleSaveChanges(draftName || undefined);
    if (success) {
      toast.success("Draft saved successfully!");
    } else {
      toast.error("Failed to save draft. Please try again.");
    }
    setDraftName("");
  };

  const handleCancelSaveDraft = () => {
    setShowDraftModal(false);
    setDraftName("");
  };

  return (
    <>
      <div
        className={`fixed z-50 transition-all duration-300 ease-in-out ${
          isChatbotOpen ? "left-0 right-[25vw]" : "w-full"
        }`}
      >
        <header className="border-b border-gray-300 bg-white px-2 sm:px-4 md:px-6 py-2 md:py-4 flex flex-col">
          <div className="flex flex-col flex-wrap lg:flex-nowrap md:flex-row md:items-center justify-between gap-2 md:gap-2">
            <div className="flex flex-row items-center space-x-4">
              <SNIcon />
              <div>
                <Title level={5} className="leading-6">
                  Auto-Graded Assignment Creator
                </Title>
                <div className="text-gray-500 font-medium text-sm leading-5 truncate max-w-[200px] sm:max-w-none">
                  {name || "Untitled Assignment"}
                </div>
              </div>
            </div>

            <Nav
              currentStepId={currentStepId}
              setCurrentStepId={setCurrentStepId}
            />

            <div className="flex flex-wrap items-center md:ml-auto gap-2 sm:gap-4 mt-2 md:mt-0 ml-auto">
              <CheckLearnerSideButton
                disabled={!questionsAreReadyToBePublished}
              />

              {/* Admin Insights Button - Only show for admins/authors when assignment exists */}
              {(role === "admin" || role === "author") &&
                activeAssignmentId && (
                  <button
                    onClick={() =>
                      window.open(
                        `/admin/insights/${activeAssignmentId}`,
                        "_blank",
                      )
                    }
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 hover:border-purple-300 transition-all duration-200 shadow-sm hover:shadow-md"
                    title="View admin insights and analytics for this assignment"
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span className="hidden sm:inline">Admin Insights</span>
                  </button>
                )}

              <SubmitQuestionsButton
                handlePublishButton={handlePublishButton}
                submitting={submitting}
                questionsAreReadyToBePublished={questionsAreReadyToBePublished}
                currentStepId={currentStepId}
              />

              <SaveAndPublishButton
                handlePublishButton={handlePublishButton}
                submitting={submitting}
                questionsAreReadyToBePublished={questionsAreReadyToBePublished}
                currentStepId={currentStepId}
              />
            </div>
          </div>

          {submitting && (
            <div className="mt-4">
              <ProgressBar
                progress={jobProgress}
                currentMessage={currentMessage}
                status={progressStatus}
              />
            </div>
          )}
        </header>
      </div>

      {showAreYouSureModal && (
        <Modal
          onClose={() => setShowAreYouSureModal(false)}
          Title="Are you sure you want to sync with the latest published version?"
        >
          <div className="p-4 space-y-4">
            <p className="typography-body">
              Syncing with the latest published version will discard any changes
              you have made. Are you sure you want to proceed?
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setShowAreYouSureModal(false)}
                className="text-sm font-medium px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSync}
                className="text-sm font-medium px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800"
              >
                Sync
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showDraftModal && (
        <Modal onClose={handleCancelSaveDraft} Title="Save as Draft">
          <div className="p-4 space-y-4">
            <p className="typography-body">
              Enter a name for this draft to help you identify it later.
            </p>
            <div className="space-y-2">
              <label
                htmlFor="draft-name"
                className="block text-sm font-medium text-gray-700"
              >
                Draft Name (Optional)
              </label>
              <input
                id="draft-name"
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={`Draft - ${new Date().toLocaleDateString()}`}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500">
                If left empty, a default name with timestamp will be used.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={handleCancelSaveDraft}
                className="text-sm font-medium px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-gray-400 focus:ring-2 focus:outline-none transition-all text-gray-700 border-gray-300 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSaveDraft}
                className="text-sm font-medium px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-blue-500 focus:ring-2 focus:outline-none transition-all text-white border-blue-600 bg-blue-600 hover:bg-blue-700 hover:border-blue-700"
              >
                Save Draft
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export default AuthorHeader;
