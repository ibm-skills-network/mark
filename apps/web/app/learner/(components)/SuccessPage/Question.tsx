import PageWithStickySides from "@/app/components/PageWithStickySides";
import MarkdownViewer from "@/components/MarkdownViewer";
import type { QuestionStore } from "@/config/types";
import { cn } from "@/lib/strings";
import { getFeedbackColors } from "@/lib/utils";
import { useLearnerStore } from "@/stores/learner";
import { useMemo, type ComponentPropsWithoutRef, type FC } from "react";
import QuestionScore from "../QuestionScore";

interface Props extends ComponentPropsWithoutRef<"section"> {
  question: QuestionStore;
  number: number;
}

const Question: FC<Props> = (props) => {
  const { question, number } = props;
  const {
    id,
    type,
    totalPoints,
    numRetries,
    questionResponses,
    question: questionText,
    learnerChoices,
    learnerTextResponse,
    learnerUrlResponse,
    learnerAnswerChoice,
  } = question;
  const showSubmissionFeedback = useLearnerStore(
    (state) => state.showSubmissionFeedback,
  );
  const highestScoreResponse = useMemo(() => {
    // Differentiate between Question feedback as assignments that provide feedback and assignments that don't
    // if showSubmissionFeedback is true, return an object, otherwise, return undefined
    // TODO: get access to showSubmissionFeedback from the backend
    if (questionResponses === undefined) return undefined;
    if (questionResponses?.length === 0 && showSubmissionFeedback) {
      // only if showSubmissionFeedback is true, return no response feedback
      return {
        points: 0,
        feedback: [{ feedback: "no response provided" }],
      };
    }
    return questionResponses.reduce((acc, curr) => {
      if (curr.points > acc.points) {
        return curr;
      }
      return acc;
    }, questionResponses[0]);
  }, [questionResponses]);
  // const attemptsRemaining = numRetries
  //   ? numRetries - questionResponses.length
  //   : -1;

  return (
    <PageWithStickySides
      leftStickySide={
        <>
          <div className="inline-flex mx-auto rounded-full border-gray-300 text-gray-500 border items-center justify-center w-11 h-11 text-2xl leading-5 font-bold">
            {number}
          </div>
          {/* Display the maxPoints value received from the child component */}
          {typeof highestScoreResponse?.points === "number" ? (
            <div className="text-blue-700 whitespace-nowrap">
              <div className="font-bold text-center">
                {highestScoreResponse.points}/{totalPoints}
              </div>
              Points
            </div>
          ) : (
            <span className="text-blue-700">{totalPoints} points</span>
          )}
        </>
      }
      mainContent={
        <div className="relative flex flex-col w-[64rem] items-center justify-center h-full gap-y-6">
          {/* question number and score */}
          <div className="flex absolute -top-8 justify-between w-full">
            <div className="flex gap-x-1">
              <p className="text-gray-600 text-xl font-medium leading-tight">
                Question {number}:
              </p>
              <p className="text-base font-medium leading-tight my-auto">
                {highestScoreResponse &&
                typeof highestScoreResponse.points === "number" ? (
                  <QuestionScore
                    earnedPoints={highestScoreResponse.points}
                    totalPoints={totalPoints}
                  />
                ) : (
                  <span className="text-blue-700">{totalPoints} points</span>
                )}
              </p>
            </div>
            {/* TODO: add times attempted? */}
          </div>
          {/* question */}
          <div className="flex flex-col w-full gap-y-6 p-8 rounded-lg bg-white border border-gray-300">
            <MarkdownViewer className="mb-4 font-medium text-gray-700 text-lg">
              {questionText}
            </MarkdownViewer>
            {type === "TRUE_FALSE" && learnerAnswerChoice !== undefined && (
              <div className="flex items-center justify-start gap-x-2">
                <p
                  className={`block text-left p-2 mb-2 border rounded ${
                    learnerAnswerChoice === true
                      ? "bg-blue-100 text-black"
                      : "bg-white text-black"
                  }`}
                >
                  True
                </p>
                <p
                  className={`block text-left p-2 mb-2 border rounded ${
                    learnerAnswerChoice === false
                      ? "bg-blue-100 text-black"
                      : "bg-white text-black"
                  }`}
                >
                  False
                </p>
              </div>
            )}

            {(type === "MULTIPLE_CORRECT" || type === "SINGLE_CORRECT") && (
              <div className="flex flex-col items-start justify-center gap-y-2">
                {question.choices.map((choice, index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex items-center justify-start gap-x-2",
                      learnerChoices?.includes(choice.choice)
                        ? "text-grey-700"
                        : "text-grey-500",
                    )}
                  >
                    <div className="flex items-center justify-center w-5 h-5 border border-gray-300 rounded-full">
                      {learnerChoices?.includes(choice.choice) ? (
                        <div className="w-2 h-2 bg-gray-300 rounded-full" />
                      ) : null}
                    </div>
                    <p className="">{choice.choice}</p>
                  </div>
                ))}
              </div>
            )}
            {type === "TEXT" && (
              <MarkdownViewer className="font-medium leading-tight">
                {learnerTextResponse}
              </MarkdownViewer>
            )}
            {type === "URL" && (
              <p className="font-medium leading-tight">{learnerUrlResponse}</p>
            )}
          </div>
          {/* feedback */}
          {highestScoreResponse?.feedback && (
            <div
              className={`w-full border p-5 rounded-lg shadow-sm ${getFeedbackColors(
                highestScoreResponse.points,
                totalPoints,
              )}`}
            >
              <p className="text-center font-medium">
                <span className="font-bold">
                  {highestScoreResponse.points}/{totalPoints}
                </span>{" "}
                {highestScoreResponse.feedback[0].feedback}
              </p>
            </div>
          )}
        </div>
      }
      // rightStickySide={<div>right</div>}
    />
  );
};

export default Question;
