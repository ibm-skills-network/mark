"use client";

import CheckLearnerSideButton from "@/app/author/(components)/Header/CheckLearnerSideButton";
import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import {
  Question,
  QuestionAuthorStore,
  ReplaceAssignmentRequest,
} from "@/config/types";
import { extractAssignmentId } from "@/lib/strings";
import { getAssignment, publishAssignment } from "@/lib/talkToBackend";
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

function AuthorHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const assignmentId = extractAssignmentId(pathname);
  const [currentStepId, setCurrentStepId] = useState<number>(0);
  const [validate] = useAssignmentConfig((state) => [state.validate]);
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
    allotedTimeMinutes,
    updatedAt,
  ] = useAssignmentConfig((state) => [
    state.numAttempts,
    state.passingGrade,
    state.displayOrder,
    state.graded,
    state.questionDisplay,
    state.allotedTimeMinutes,
    state.updatedAt,
  ]);
  const [showSubmissionFeedback, showQuestionScore, showAssignmentScore] =
    useAssignmentFeedbackConfig((state) => [
      state.showSubmissionFeedback,
      state.showQuestionScore,
      state.showAssignmentScore,
    ]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const fetchAssignment = async () => {
    const assignment = await getAssignment(~~assignmentId);
    if (assignment) {
      useAuthorStore.getState().setOriginalAssignment(assignment);

      // Author store
      const mergedAuthorData = mergeData(useAuthorStore.getState(), assignment);

      const { updatedAt, ...cleanedAuthorData } = mergedAuthorData;
      setAuthorStore({
        ...cleanedAuthorData,
        // updatedAt: Date.now()
      });
      // Assignment Config store
      const mergedAssignmentConfigData = mergeData(
        useAssignmentConfig.getState(),
        assignment,
      );
      if (assignment.questionVariationNumber !== undefined) {
        setAssignmentConfigStore({
          questionVariationNumber: assignment.questionVariationNumber,
        });
      }
      const {
        updatedAt: authorStoreUpdatedAt,
        ...cleanedAssignmentConfigData
      } = mergedAssignmentConfigData;
      setAssignmentConfigStore({
        ...cleanedAssignmentConfigData,
      });

      // Assignment Feedback Config store
      const mergedAssignmentFeedbackData = mergeData(
        useAssignmentFeedbackConfig.getState(),
        assignment,
      );
      const {
        updatedAt: assignmentFeedbackUpdatedAt,
        ...cleanedAssignmentFeedbackData
      } = mergedAssignmentFeedbackData;
      setAssignmentFeedbackConfigStore({
        ...cleanedAssignmentFeedbackData,
        // updatedAt: Date.now(),
      });
      useAuthorStore.getState().setName(assignment.name);
      setPageState("success");
    } else {
      setPageState("error");
    }
  };
  useEffect(() => {
    setActiveAssignmentId(~~assignmentId);
    void fetchAssignment();
  }, [assignmentId]);

  async function handlePublishButton() {
    setSubmitting(true);
    const clonedCurrentQuestions: QuestionAuthorStore[] = JSON.parse(
      JSON.stringify(questions),
    ) as QuestionAuthorStore[];
    const clonedOriginalQuestions: QuestionAuthorStore[] = JSON.parse(
      JSON.stringify(originalAssignment.questions),
    ) as QuestionAuthorStore[];

    function removeEphemeralFields(questionArray: QuestionAuthorStore[]) {
      questionArray.forEach((q) => {
        delete q.alreadyInBackend;
      });
    }
    removeEphemeralFields(clonedCurrentQuestions);
    removeEphemeralFields(clonedOriginalQuestions);

    const questionsAreDifferent =
      JSON.stringify(clonedCurrentQuestions) !==
      JSON.stringify(clonedOriginalQuestions);
    const assignmentData: ReplaceAssignmentRequest = {
      introduction,
      instructions,
      gradingCriteriaOverview,
      numAttempts,
      passingGrade,
      displayOrder,
      graded,
      questionDisplay,
      allotedTimeMinutes: allotedTimeMinutes || null,
      updatedAt,
      questionOrder,
      published: true,
      showSubmissionFeedback,
      showQuestionScore,
      showAssignmentScore,
      questions: questionsAreDifferent ? processQuestions(questions) : null,
    };
    try {
      const response = await publishAssignment(
        activeAssignmentId,
        assignmentData,
      );

      if (response.success) {
        if (response.questions && response.questions.length > 0) {
          setQuestions(response.questions);
        }
        void fetchAssignment();
        toast.success("Questions published successfully!");
        const currentTime = Date.now();

        questions.forEach((question) => {
          question.alreadyInBackend = true;
        });
        router.push(
          `/author/${activeAssignmentId}?submissionTime=${currentTime}`,
        );
      } else {
        toast.error("Couldn't publish all questions. Please try again.");
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast.error(`Error during publishing: ${error.message}`);
      } else {
        toast.error("An unknown error occurred during publishing.");
      }
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="fixed w-full z-50">
      <header className="border-b border-gray-300 px-6 py-4 bg-white flex items-center justify-between">
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
            disabled={!questionsAreReadyToBePublished && validate()}
          />
          <SubmitQuestionsButton
            handlePublishButton={handlePublishButton}
            submitting={submitting}
            questionsAreReadyToBePublished={questionsAreReadyToBePublished}
          />
        </div>
      </header>
    </div>
  );
}

export default AuthorHeader;
