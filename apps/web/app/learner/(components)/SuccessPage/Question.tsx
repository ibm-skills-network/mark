import PageWithStickySides from "@/app/components/PageWithStickySides";
import { QuestionStore } from "@/config/types";
import { getFeedbackColors } from "@/lib/utils";
import { useMemo, type ComponentPropsWithoutRef, type FC } from "react";
import ReactMarkdown from "react-markdown";
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
  } = question;

  const highestScoreResponse = useMemo(() => {
    if (questionResponses?.length === 0) {
      return {
        points: 0,
        feedback: [{ feedback: "question has not been submitted" }],
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
          <div className="text-blue-700 whitespace-nowrap">
            <div className="font-bold text-center">
              {highestScoreResponse.points}/{totalPoints}
            </div>
            Points
          </div>
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
                {highestScoreResponse ? (
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
            <ReactMarkdown className="mb-4 font-medium text-gray-700 text-lg">
              {questionText}
            </ReactMarkdown>
            {type === "MULTIPLE_CORRECT" && (
              <div className="flex flex-col items-start justify-center gap-y-2">
                {question.choices.map((option, index) => (
                  <div
                    key={index}
                    className={
                      "flex items-center justify-start gap-x-2 " +
                      (learnerChoices.includes(option)
                        ? "text-grey-700"
                        : "text-grey-500")
                    }
                  >
                    <div className="flex items-center justify-center w-5 h-5 border border-gray-300 rounded-full">
                      <div className="w-2 h-2 bg-gray-300 rounded-full" />
                    </div>
                    <p className="">{option}</p>
                  </div>
                ))}
              </div>
            )}
            {type === "TEXT" && (
              <ReactMarkdown className="font-medium leading-tight">
                {learnerTextResponse}
              </ReactMarkdown>
            )}
            {type === "URL" && (
              <p className="font-medium leading-tight">{learnerUrlResponse}</p>
            )}
          </div>
          {/* feedback */}
          <div
            className={
              "w-full border p-5 rounded-lg shadow-sm " +
              getFeedbackColors(highestScoreResponse.points, totalPoints)
            }
          >
            <p className="text-center font-medium">
              <span className="font-bold">
                {highestScoreResponse.points}/{totalPoints}
              </span>{" "}
              {highestScoreResponse.feedback[0].feedback}
            </p>
          </div>
        </div>
      }
      // rightStickySide={<div>right</div>}
    />
  );
};

export default Question;
