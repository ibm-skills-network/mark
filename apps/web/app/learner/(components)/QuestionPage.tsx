"use client";

import type {
  AssignmentAttemptWithQuestions,
  LearnerGetQuestionResponse,
  QuestionStatus,
  QuestionStore,
} from "@/config/types";
import { useLearnerStore } from "@/stores/learner";
import { questionsData } from "@config/constants";
import Button from "@learnerComponents/Button";
import Overview from "@learnerComponents/Overview";
import QuestionContainer from "@learnerComponents/QuestionContainer";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  attempt: AssignmentAttemptWithQuestions;
}

function QuestionPage(props: Props) {
  const { attempt } = props;
  const { questions } = attempt;

  const questionsStore = useLearnerStore((state) => state.questions);
  const addQuestion = useLearnerStore((state) => state.addQuestion);

  // store the questions in zustand store
  useEffect(() => {
    // TODO: remove this once we have the backend fully integrated
    questionsData.concat(questions).forEach((question: QuestionStore) => {
      // take out the info about previous attempts

      // add the input field for the question
      switch (question.type) {
        case "TEXT":
          question.learnerTextResponse = "";
          break;
        case "URL":
          question.learnerUrlResponse = "";
          break;
        case "SINGLE_CORRECT":
          question.learnerChoices = [];
          break;
        case "MULTIPLE_CORRECT":
          question.learnerChoices = [];
          break;
        case "TRUE_FALSE":
          question.learnerAnswerChoice = undefined;
          break;
        case "UPLOAD":
          question.learnerFileResponse = undefined;
          break;
        default:
          break;
      }
      // store the question in zustand store
      addQuestion(question);
    });
  }, [questions, addQuestion]);

  const [activeQuestionId, setActiveQuestionId] = useLearnerStore((state) => [
    state.activeQuestionId,
    state.setActiveQuestionId,
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  // const [submittedSuccessfully, setSubmittedSuccessfully] = useState(false);
  const submittedSuccessfully = false;

  const isLastQuestion = false;

  if (!questionsStore.length) {
    console.log(
      "🚀 ~ file: QuestionPage.tsx:88 ~ QuestionPage ~ questionsStore.length:",
      questionsStore.length
    );
    return (
      <div className="col-span-4 flex items-center justify-center h-full">
        <h1>Loading...</h1>
      </div>
    );
  }
  console.log(
    "🚀 ~ file: QuestionPage.tsx:88 ~ QuestionPage ~ questionsStore.length:",
    questionsStore.length
  );

  return (
    <>
      {submittedSuccessfully ? (
        <div className="col-span-4 flex items-center justify-center h-full">
          <h1>Thank you for your attempt!</h1>
        </div>
      ) : (
        <>
          <div className="col-span-3 -mt-6">
            {questionsStore.map((question, index) => (
              <QuestionContainer
                key={index}
                questionNumber={index + 1}
                className={`${index === activeQuestionId ? "" : "hidden"} `}
                question={question}
              />
            ))}

            <div className="flex justify-between mt-4">
              <Button
                onClick={() => setActiveQuestionId(activeQuestionId - 1)}
                style={{
                  opacity: activeQuestionId === 0 ? 0 : 1,
                  cursor: activeQuestionId === 0 ? "default" : "pointer",
                }}
                disabled={activeQuestionId === 0}
              >
                Previous
              </Button>

              {isLastQuestion ? (
                <Button
                  onClick={() => setShowWarning(true)}
                  disabled={submitting}
                >
                  {submitting ? "Submitting..." : "Submit Assignment"}
                </Button>
              ) : (
                <Button
                  onClick={() => setActiveQuestionId(activeQuestionId + 1)}
                  disabled={activeQuestionId === questionsData.length - 1}
                >
                  Next
                </Button>
              )}
            </div>
          </div>
          <div className="col-span-1">
            <Overview timeLimit={3600} setCurrentIndex={setActiveQuestionId} />
          </div>

          {/* Attempt Warning Modal */}
          {/* {showWarning && (
            <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center bg-opacity-50 bg-black">
              <div className="bg-white p-8 rounded shadow-lg">
                <p>
                  Once submitted, no more changes can be made. Are you sure you
                  want to submit?
                </p>
                <div className="flex justify-end mt-4">
                  <Button onClick={() => setShowWarning(false)}>Cancel</Button>
              <Button className="ml-2" onClick={handleAttempt}>
                Yes, Submit
              </Button>
                </div>
              </div>
            </div>
          )} */}
        </>
      )}
    </>
  );
}

export default QuestionPage;
