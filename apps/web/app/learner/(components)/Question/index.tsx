"use client";

import type {
  AssignmentAttemptWithQuestions,
  QuestionStatus,
  QuestionStore,
} from "@/config/types";
import { useLearnerStore } from "@/stores/learner";
import { questionsData } from "@config/constants";
import Button from "@learnerComponents/Button";
import Overview from "@learnerComponents/Overview";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import QuestionContainer from "./QuestionContainer";

interface Props extends ComponentPropsWithoutRef<"div"> {
  attempt: AssignmentAttemptWithQuestions;
  assignmentId: number;
}

function QuestionPage(props: Props) {
  const { attempt, assignmentId } = props;
  const { questions, id } = attempt;

  const questionsStore = useLearnerStore((state) => state.questions);
  const addQuestion = useLearnerStore((state) => state.addQuestion);

  // store the questions in zustand store
  useEffect(() => {
    const allQuestions: QuestionStore[] = questions
      // .concat(questionsData)
      .map((question: QuestionStore) => {
        // get the info about previous attempts
        const previousAttempts = question.questionResponses.map((response) => ({
          points: response.points,
          learnerResponse: response.learnerResponse,
        }));
        // get the highest points earned for the question by finding the highest points earned for each response
        // const earnedPoints = previousAttempts.reduce(
        //   (highestPoints, response) => {
        //     return response.points > highestPoints.points
        //       ? response
        //       : highestPoints;
        //   }
        // );
        // get the last submission for the question
        const lastSubmission = previousAttempts.slice(-1)[0];

        // add the input field for the question
        switch (question.type) {
          case "TEXT":
            // Autofill the text response with the last submission if it exists
            question.learnerTextResponse =
              lastSubmission?.learnerResponse || "";
            break;
          // TODO: handle other types of questions
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
        return question;
      });
    useLearnerStore.setState({
      questions: allQuestions,
      activeAttemptId: id,
      activeAssignmentId: assignmentId,
    });
  }, []);

  // useEffect(
  //   () =>
  //     useLearnerStore.subscribe((state) => {
  //       console.log(state.questions);
  //     }),
  //   []
  // );

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
    return (
      <div className="col-span-4 flex items-center justify-center h-full">
        <h1>Loading...</h1>
      </div>
    );
  }

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
                // questionNumber={index + 1}
                className={`${index + 1 === activeQuestionId ? "" : "hidden"} `}
                questionId={question.id}
                // question={question}
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
            <Overview />
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
