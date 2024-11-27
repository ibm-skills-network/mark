"use client";

import CheckLearnerSideButton from "@/app/author/(components)/Header/CheckLearnerSideButton";
import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import { Question } from "@/config/types";
import { extractAssignmentId } from "@/lib/strings";
import { getAssignment, updateQuestions } from "@/lib/talkToBackend";
import { mergeData } from "@/lib/utils";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import Modal from "@components/Modal";
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
  const [isModalOpen, setModalOpen] = useState(false);
  const pathname = usePathname();
  const assignmentId = extractAssignmentId(pathname);
  const [currentStepId, setCurrentStepId] = useState<number>(0);
  const [validate] = useAssignmentConfig((state) => [state.validate]);
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
  const questionVariationNumber = useAssignmentConfig(
    (state) => state.questionVariationNumber,
  );
  const [submitting, setSubmitting] = useState<boolean>(false);
  useEffect(() => {
    setActiveAssignmentId(~~assignmentId);
    const fetchAssignment = async () => {
      const assignment = await getAssignment(~~assignmentId);
      if (assignment) {
        // Author store
        const mergedAuthorData = mergeData(
          useAuthorStore.getState(),
          assignment,
        );

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
        setPageState("success");
      } else {
        setPageState("error");
      }
    };
    void fetchAssignment();
  }, [assignmentId]);

  async function handlePublishButton() {
    setSubmitting(true);

    try {
      // Send a single request with all the processed questions
      const success = await updateQuestions(
        activeAssignmentId,
        processQuestions(questions),
      );

      if (success) {
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
