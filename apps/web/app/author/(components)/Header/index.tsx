"use client";

import CheckLearnerSideButton from "@/app/author/(components)/Header/CheckLearnerSideButton";
import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import ProgressBar, { JobStatus } from "@/components/ProgressBar";
import {
  Question,
  QuestionAuthorStore,
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

  // Fetch assignment details on load.
  const fetchAssignment = async () => {
    const assignment = await getAssignment(~~assignmentId);
    if (assignment) {
      // Decode specific fields
      const decodedFields = decodeFields({
        introduction: assignment.introduction,
        instructions: assignment.instructions,
        gradingCriteriaOverview: assignment.gradingCriteriaOverview,
      });

      // Merge decoded fields back into assignment
      const decodedAssignment = {
        ...assignment,
        ...decodedFields,
      };

      useAuthorStore.getState().setOriginalAssignment(decodedAssignment);

      // Author store
      const mergedAuthorData = mergeData(
        useAuthorStore.getState(),
        decodedAssignment,
      );
      const { updatedAt, ...cleanedAuthorData } = mergedAuthorData;
      setAuthorStore({
        ...cleanedAuthorData,
      });
      const mergedAssignmentConfigData = mergeData(
        useAssignmentConfig.getState(),
        decodedAssignment,
      );
      if (decodedAssignment.questionVariationNumber !== undefined) {
        setAssignmentConfigStore({
          questionVariationNumber: decodedAssignment.questionVariationNumber,
        });
      }
      const {
        updatedAt: authorStoreUpdatedAt,
        ...cleanedAssignmentConfigData
      } = mergedAssignmentConfigData;
      setAssignmentConfigStore({
        ...cleanedAssignmentConfigData,
      });
      // Merge assignment feedback config data.
      const mergedAssignmentFeedbackData = mergeData(
        useAssignmentFeedbackConfig.getState(),
        decodedAssignment,
      );
      const {
        updatedAt: assignmentFeedbackUpdatedAt,
        ...cleanedAssignmentFeedbackData
      } = mergedAssignmentFeedbackData;
      setAssignmentFeedbackConfigStore({
        ...cleanedAssignmentFeedbackData,
      });

      useAuthorStore.getState().setName(decodedAssignment.name);
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

  // Handle Publish Button: prepare data and subscribe to SSE updates.
  async function handlePublishButton() {
    setSubmitting(true);
    // Reset progress state.
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
    const clonedCurrentQuestions = JSON.parse(
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
      questions: questionsAreDifferent ? processQuestions(questions) : null,
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
            setQuestions(questions);
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

  return (
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
  );
}

export default AuthorHeader;
