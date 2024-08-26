"use client";

import {
  updateAssignment,
  updateQuestions,
  getAssignment,
} from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import SubmitQuestionsButton from "./SubmitQuestionsButton";
import { Nav } from "./Nav";
import { extractAssignmentId } from "@/lib/strings";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { mergeData } from "@/lib/utils";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";

function AuthorHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const assignmentId = extractAssignmentId(pathname);
  const [currentStepId, setCurrentStepId] = useState<number>(0);
  const [setActiveAssignmentId, questions, setPageState, setAuthorStore,activeAssignmentId, name] =
    useAuthorStore((state) => [
      state.setActiveAssignmentId,
      state.questions,
      state.setPageState,
      state.setAuthorStore,
      state.activeAssignmentId,
      state.name,
    ]);
  const [setAssignmentConfigStore] = useAssignmentConfig((state) => [
    state.setAssignmentConfigStore,
  ]);
  const [setAssignmentFeedbackConfigStore] = useAssignmentFeedbackConfig(
    (state) => [state.setAssignmentFeedbackConfigStore],
  );
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setActiveAssignmentId(~~assignmentId);
    const fetchAssignment = async () => {
      const assignment = await getAssignment(~~assignmentId);
      if (assignment) {
        // update all the stores with the data from the backend/mergedData

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
        const {
          updatedAt: authorStoreUpdatedAt,
          ...cleanedAssignmentConfigData
        } = mergedAssignmentConfigData;
        setAssignmentConfigStore({
          ...cleanedAssignmentConfigData,
          // updatedAt: Date.now(),
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

  // check if all questions have been filled out
  const questionsAreReadyToBePublished = useMemo(() => {
    // TODO: show a custom error message for each case
    return questions.every((eachQuestion) => {
      const { type, question, choices, scoring } = eachQuestion;
      // Check if the question text is empty or contains only whitespace
      const questionTextFilledOut =
        question.replace(/<\/?[^>]+(>|$)/g, "").trim().length > 0;
      if (type === "URL" || type === "TEXT") {
        //criteria needs to be filled out
        const criteriaFilledOut = scoring?.criteria?.every(
          (criteria) => criteria.description.trim().length > 0,
        );
        const doesCriteriaExist = scoring?.criteria?.length > 0;

        if (
          !criteriaFilledOut ||
          !doesCriteriaExist ||
          !questionTextFilledOut
        ) {
          // disable publish button if criteria is not filled out
          return false;
        }
      }
      // if type is multiple correct, check if there are at least 2 choices
      if (type === "MULTIPLE_CORRECT") {
        if (!choices) {
          // disable publish button if choices is not filled out
          return false;
        }

        const choicesFilledOut = choices?.every((choice) => {
          return choice?.choice?.trim().length > 0;
        });
        const isTwoOrMoreChoices = choices?.length >= 2;
        const isAtLeastOneCorrectChoice = choices?.some(
          (choice) => choice.isCorrect,
        );

        if (
          !choicesFilledOut ||
          !isTwoOrMoreChoices ||
          !isAtLeastOneCorrectChoice ||
          !questionTextFilledOut
        ) {
          // disable publish button if choices requirements is not satisfied
          return false;
        }
      }
      return questionTextFilledOut;
    });
  }, [questions]);

  // useEffect(() => {
  // 	setActiveAssignmentId(Number(activeAssignmentId));
  // }, [activeAssignmentId]);

  async function handlePublishButton() {
    setSubmitting(true);

    // Process all questions to prepare them for the single request
    const processedQuestions = questions.map((question) => {
      // Destructure and remove values that are not needed in the backend
      const { alreadyInBackend, index, id, assignmentId, ...dataToSend } =
        question;

      // Handle specific types: TEXT, URL, and MULTIPLE_CORRECT
      if (dataToSend.type === "TEXT" || dataToSend.type === "URL") {
        // Remove id from criteria since it's not needed in the backend
        for (const criteria of dataToSend.scoring.criteria) {
          delete criteria.id; // You can also use `criteria.id = undefined;` if `delete` is not preferred
        }
      } else if (dataToSend.type === "MULTIPLE_CORRECT") {
        dataToSend.totalPoints = dataToSend.choices?.reduce(
          (acc, curr) => acc + curr.points,
          0,
        ); // Sum up all the points
        dataToSend.scoring = null; // Scoring is not needed for multiple correct
      }

      // Handle unlimited retries
      dataToSend.numRetries =
        dataToSend.numRetries === -1 ? null : dataToSend.numRetries;

      return {
        ...dataToSend,
        alreadyInBackend, // include alreadyInBackend
        id, // include id if it's already in the backend
        assignmentId, // include assignmentId
      };
    });

    try {
      // Send a single request with all the processed questions
      const success = await updateQuestions(
        activeAssignmentId,
        processedQuestions,
      );

      if (success) {
        // Update the assignment with the question order and publish it
        const updated = await updateAssignment(
          {
            questionOrder: useAuthorStore.getState().questionOrder,
            published: true,
          },
          activeAssignmentId,
        );

        if (updated) {
          const currentTime = Date.now();
          router.push(
            `/author/${activeAssignmentId}?submissionTime=${currentTime}`,
          );
        } else {
          toast.error("Couldn't publish all questions. Please try again.");
        }
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

  function handleScrollToTarget(questionId: number) {
    if (typeof questionId !== "number") {
      throw new Error("questionId must be a string");
    }

    // Scroll to the specified target
    const targetElement = document.getElementById(`question-${questionId}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <div className="fixed w-full z-50">
      <header className="border-b border-gray-300 px-6 py-6 bg-white justify-between gap-x-16 grid grid-cols-4">
        <div className="flex">
          <div className="flex flex-col justify-center pr-4">
            <SNIcon />
          </div>
          <div>
            <Title level={5} className="leading-6">
              Auto-Graded Assignment Creator
            </Title>
            <div className="text-gray-500 font-medium text-sm leading-5">
              {name || "Untitled Assignment"}
            </div>
          </div>
        </div>
        <Nav
          currentStepId={currentStepId}
          setCurrentStepId={setCurrentStepId}
        />
        <div className="items-center flex justify-end gap-x-2.5">
          {currentStepId === 2 && (
            <SubmitQuestionsButton
              handlePublishButton={handlePublishButton}
              submitting={submitting}
              questionsAreReadyToBePublished={questionsAreReadyToBePublished}
            />
          )}

          {/* Add this back if we wanna have learner view for the authors */}
          {/* <button
            className="inline-flex items-center px-4 py-2 border border-transparent leading-6 font-medium rounded-md text-blue-700 hover:text-blue-500 bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <EyeIcon className="h-5 w-5 mr-2" aria-hidden="true" />
            Learner View
          </button> */}
        </div>
      </header>
    </div>
  );
}

export default AuthorHeader;
