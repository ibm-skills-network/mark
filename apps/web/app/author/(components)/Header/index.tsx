"use client";

import CheckLearnerSideButton from "@/app/author/(components)/Header/CheckLearnerSideButton";
import { useMarkChatStore } from "@/app/chatbot/store/useMarkChatStore";
import { useChangesSummary } from "@/app/Helpers/checkDiff";
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
import { IconRefresh } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuestionsAreReadyToBePublished } from "../../../Helpers/checkQuestionsReady";
import { Nav } from "./Nav";
import SubmitQuestionsButton from "./SubmitQuestionsButton";

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
  ] = useAssignmentFeedbackConfig((state) => [
    state.showSubmissionFeedback,
    state.showQuestionScore,
    state.showAssignmentScore,
    state.showQuestions,
  ]);
  const [role, setRole] = useAuthorStore((state) => [
    state.role,
    state.setRole,
  ]);

  const [showAreYouSureModal, setShowAreYouSureModal] =
    useState<boolean>(false);

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
      });

      useAuthorStore.getState().setName(newAssignment.name);
      useAuthorStore.getState().setActiveAssignmentId(newAssignment.id);

      setPageState("success");
    } catch (error) {
      setPageState("error");
    }
  };

  const fetchAssignment = async () => {
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

  async function handlePublishButton() {
    setSubmitting(true);
    setJobProgress(0);
    setCurrentMessage("Initializing publishing...");
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
      passingGrade,
      displayOrder,
      graded,
      questionDisplay,
      allotedTimeMinutes: allotedTimeMinutes || null,
      updatedAt,
      questionOrder,
      timeEstimateMinutes: timeEstimateMinutes,
      published: true,
      showSubmissionFeedback,
      showQuestions,
      showQuestionScore,
      showAssignmentScore,
      numberOfQuestionsPerAttempt,
      questions: questionsAreDifferent
        ? processQuestions(clonedCurrentQuestions)
        : null,
    };
    if (assignmentData.introduction === null) {
      toast.error("Introduction is required to publish the assignment.");
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
        toast.success("Questions published successfully!");
        setProgressStatus("Completed");
        setTimeout(() => {
          router.push(
            `/author/${activeAssignmentId}?submissionTime=${Date.now()}`,
          );
        }, 300);
      } else {
        toast.error(
          "Failed to start the publishing process. Please try again.",
        );
        setProgressStatus("Failed");
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast.error(`Error during publishing: ${error.message}`);
      } else {
        toast.error("An unknown error occurred during publishing.");
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

  return (
    <>
      <div className="fixed w-full z-50">
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
              <Tooltip
                content="Sync with the latest published version, discarding any changes you have made."
                distance={-3}
              >
                <button
                  onClick={handleSyncWithLatestPublishedVersion}
                  className="text-sm flex font-medium items-center justify-center px-2 sm:px-3 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 text-violet-800 border-violet-100 bg-violet-50 hover:bg-violet-100 dark:text-violet-100 dark:border-violet-800 dark:bg-violet-900 dark:hover:bg-violet-950"
                >
                  <IconRefresh className="h-5 w-5" />
                  <span className="ml-2">Sync with latest</span>
                </button>
              </Tooltip>

              <CheckLearnerSideButton
                disabled={!questionsAreReadyToBePublished}
              />

              <SubmitQuestionsButton
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
    </>
  );
}

export default AuthorHeader;
