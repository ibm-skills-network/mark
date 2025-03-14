"use client";

import CheckLearnerSideButton from "@/app/author/(components)/Header/CheckLearnerSideButton";
import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import ProgressBar, { JobStatus } from "@/components/ProgressBar";
import {
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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuestionsAreReadyToBePublished } from "../../../Helpers/checkQuestionsReady";
import { Nav } from "./Nav";
import SubmitQuestionsButton from "./SubmitQuestionsButton";
import { encodeFields } from "@/app/Helpers/encoder";
import { decodeFields } from "@/app/Helpers/decoder";
import { stripHtml } from "@/app/Helpers/strippers";
import { IconRefresh } from "@tabler/icons-react";
import { useChangesSummary } from "@/app/Helpers/checkDiff";
import Modal from "@/components/Modal";

function AuthorHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const assignmentId = extractAssignmentId(pathname);

  const [currentStepId, setCurrentStepId] = useState<number>(0);
  const setQuestions = useAuthorStore((state) => state.setQuestions);
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
  ] = useAssignmentConfig((state) => [
    state.numAttempts,
    state.passingGrade,
    state.displayOrder,
    state.graded,
    state.questionDisplay,
    state.timeEstimateMinutes,
    state.allotedTimeMinutes,
    state.updatedAt,
  ]);
  const [showSubmissionFeedback, showQuestionScore, showAssignmentScore] =
    useAssignmentFeedbackConfig((state) => [
      state.showSubmissionFeedback,
      state.showQuestionScore,
      state.showAssignmentScore,
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

  // STATES FOR PROGRESS BAR & ROADMAP
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [currentMessage, setCurrentMessage] = useState<string>(
    "Initializing publishing...",
  );
  const [progressStatus, setProgressStatus] =
    useState<JobStatus>("In Progress");

  // Countdown state for learner redirection.
  const [countdown, setCountdown] = useState<number>(10);

  // // POLLING: Check user role every 5 seconds.
  // useEffect(() => {
  //   const pollInterval = setInterval(async () => {
  //     const user = await getUser();
  //     if (user && user.role !== role) {
  //       setRole(user.role);
  //     }
  //   }, 5000);
  //   return () => clearInterval(pollInterval);
  // }, [role]);

  // // Countdown effect: if role is not author, start/restart countdown.
  // useEffect(() => {
  //   let timerId: NodeJS.Timeout | null = null;
  //   if (role !== "author") {
  //     setCountdown(10);
  //     timerId = setInterval(() => {
  //       setCountdown((prev) => {
  //         if (prev <= 1) {
  //           if (timerId) clearInterval(timerId);
  //           router.replace(`/learner/${assignmentId}`);
  //           return 0;
  //         }
  //         return prev - 1;
  //       });
  //     }, 1000);
  //   }
  //   return () => {
  //     if (timerId) clearInterval(timerId);
  //   };
  // }, [role, assignmentId, router]);

  const SyncAssignment = async () => {
    try {
      // 1) Fetch the assignment
      const assignment = await getAssignment(~~assignmentId);
      if (!assignment) {
        setPageState("error");
        return;
      }

      // 2) Decode specific fields
      const decodedFields = decodeFields({
        introduction: assignment.introduction,
        instructions: assignment.instructions,
        gradingCriteriaOverview: assignment.gradingCriteriaOverview,
      });

      const decodedAssignment = {
        ...assignment,
        ...decodedFields,
      };

      const questions: QuestionAuthorStore[] =
        assignment.questions?.map(
          (question: QuestionAuthorStore, index: number) => {
            const criteriaWithId = question.scoring?.criteria?.map(
              (criteria: Criteria, criteriaIndex: number) => ({
                ...criteria,
                index: criteriaIndex + 1,
              }),
            );

            const parsedVariants: QuestionVariants[] =
              question.variants?.map((variant: QuestionVariants) => ({
                ...variant,
                choices:
                  typeof variant.choices === "string"
                    ? (JSON.parse(variant.choices) as Choice[])
                    : variant.choices,
              })) || [];

            return {
              ...question,
              alreadyInBackend: true,
              variants: parsedVariants,
              scoring: {
                type: "CRITERIA_BASED",
                rubrics: [
                  {
                    rubricQuestion: stripHtml(question.question),
                    criteria: criteriaWithId || [],
                  },
                ],
              },
              index: index + 1,
            };
          },
        ) || [];

      decodedAssignment.questions = questions;

      useAuthorStore.getState().setOriginalAssignment(decodedAssignment);

      useAuthorStore.getState().setAuthorStore(decodedAssignment);
      useAssignmentConfig.getState().setAssignmentConfigStore({
        numAttempts: decodedAssignment.numAttempts,
        passingGrade: decodedAssignment.passingGrade,
        displayOrder: decodedAssignment.displayOrder,
        graded: decodedAssignment.graded,
        questionDisplay: decodedAssignment.questionDisplay,
        timeEstimateMinutes: decodedAssignment.timeEstimateMinutes,
        allotedTimeMinutes: decodedAssignment.allotedTimeMinutes,
        updatedAt: decodedAssignment.updatedAt,
      });

      if (decodedAssignment.questionVariationNumber !== undefined) {
        setAssignmentConfigStore({
          questionVariationNumber: decodedAssignment.questionVariationNumber,
        });
      }

      useAssignmentFeedbackConfig.getState().setAssignmentFeedbackConfigStore({
        showSubmissionFeedback: decodedAssignment.showSubmissionFeedback,
        showQuestionScore: decodedAssignment.showQuestionScore,
        showAssignmentScore: decodedAssignment.showAssignmentScore,
      });

      useAuthorStore.getState().setName(decodedAssignment.name);
      useAuthorStore.getState().setActiveAssignmentId(decodedAssignment.id);

      setPageState("success");
    } catch (error) {
      setPageState("error");
    }
  };

  const fetchAssignment = async () => {
    const assignment = await getAssignment(~~assignmentId);
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
      const questions: QuestionAuthorStore[] = assignment.questions?.map(
        (question: QuestionAuthorStore, index: number) => {
          const criteriaWithId = question.scoring?.criteria?.map(
            (criteria: Criteria, criteriaIndex: number) => ({
              ...criteria,
              index: criteriaIndex + 1,
            }),
          );
          const parsedVariants: QuestionVariants[] =
            question.variants?.map((variant: QuestionVariants) => ({
              ...variant,
              choices:
                typeof variant.choices === "string"
                  ? (JSON.parse(variant.choices) as Choice[])
                  : variant.choices,
            })) || [];

          return {
            ...question,
            alreadyInBackend: true,
            variants: parsedVariants,
            scoring: {
              type: "CRITERIA_BASED",
              rubrics: [
                {
                  rubricQuestion: stripHtml(question.question),
                  criteria: criteriaWithId || [],
                },
              ],
            },
            index: index + 1,
          };
        },
      );
      decodedAssignment.questions = questions;
      useAuthorStore.getState().setOriginalAssignment(decodedAssignment);

      const mergedAuthorData = mergeData(
        useAuthorStore.getState(),
        decodedAssignment,
      );
      const { updatedAt, ...cleanedAuthorData } = mergedAuthorData;
      setAuthorStore({
        ...cleanedAuthorData,
      });

      if (decodedAssignment.questionVariationNumber !== undefined) {
        setAssignmentConfigStore({
          questionVariationNumber: decodedAssignment.questionVariationNumber,
        });
      }
      useAuthorStore.getState().setName(decodedAssignment.name);
      useAuthorStore.getState().setActiveAssignmentId(decodedAssignment.id);
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
    return user.role;
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
  // Handle Publish Button: prepare data and subscribe to SSE updates.
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

    // Deep clone current & original questions for comparison.
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
      showQuestionScore,
      showAssignmentScore,
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
        // Subscribe to SSE updates.
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
    // check if the user has made any changes to the assignment
    console.log(changesSummary);
    if (changesSummary !== "No changes detected.") {
      setShowAreYouSureModal(true);
      return;
    } else {
      await SyncAssignment();
      toast.success("Synced with latest published version.");
    }
  };

  const handleConfirmSync = async () => {
    // delete the current store
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
        {countdown > 0 && role !== "author" && (
          <p className="text-sm text-gray-700">
            Switching to learner mode in {countdown} second
            {countdown !== 1 && "s"}
          </p>
        )}
        <header className="border-b border-gray-300 px-6 py-4 bg-white flex flex-col">
          {/* Top row with header information and navigation */}
          <div className="flex items-center justify-between">
            {/* Left Section */}
            <div className="flex items-center space-x-4">
              <SNIcon />
              <div>
                <Title level={5} className="leading-6">
                  Auto-Graded Assignment Creator
                </Title>
                <div className="text-gray-500 font-medium text-sm leading-5">
                  {name || "Untitled Assignment"}
                </div>
              </div>
            </div>

            {/* Center Navigation */}
            <Nav
              currentStepId={currentStepId}
              setCurrentStepId={setCurrentStepId}
            />

            {/* Right Section */}
            <div className="flex items-center space-x-4">
              <button
                onClick={handleSyncWithLatestPublishedVersion}
                className="text-sm flex font-medium items-center justify-center px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 text-violet-800 border-violet-100 bg-violet-50 hover:bg-violet-100 dark:text-violet-100 dark:border-violet-800 dark:bg-violet-900 dark:hover:bg-violet-950"
              >
                <IconRefresh />
                <span className="ml-2">Sync with latest published version</span>
              </button>
              <CheckLearnerSideButton
                disabled={!questionsAreReadyToBePublished}
              />
              <SubmitQuestionsButton
                handlePublishButton={handlePublishButton}
                submitting={submitting}
                questionsAreReadyToBePublished={questionsAreReadyToBePublished}
              />
            </div>
          </div>

          {/* Enhanced Progress Bar with Roadmap (only visible during publishing) */}
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
          <div className="p-4">
            <p className="typography-body">
              Syncing with the latest published version will discard any changes
              you have made to the assignment. Are you sure you want to proceed?
            </p>
            <div className="flex justify-end mt-10">
              <button
                onClick={() => setShowAreYouSureModal(false)}
                className="text-sm font-medium items-center justify-center px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSync}
                className="text-sm font-medium items-center justify-center px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800 ml-2"
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
