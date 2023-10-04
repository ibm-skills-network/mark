import {
  Question,
  QuestionAttemptRequest,
  QuestionStatus,
  QuestionStore,
} from "@/config/types";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { useState } from "react";
import Button from "../Button";
import InfoLine from "../InfoLine";

interface Props {}

function TrueFalseQuestion(props: Props) {
  const {} = props;
  const activeQuestionId = useLearnerStore((state) => state.activeQuestionId);

  const [questions, setTextResponse] = useLearnerStore((state) => [
    state.questions,
    state.setTextResponse,
  ]);
  const { question, id } = questions[activeQuestionId - 1];

  const [selectedChoice, setSelectedChoice] = useState<boolean | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState<boolean>(false);

  const assignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id
  );

  const handleChoiceClick = (choice: boolean) => {
    if (!submitted) {
      setSelectedChoice(choice);
      setSubmitted(false);
    }
  };

  const handleSubmit = () => {
    const questionResponse: QuestionAttemptRequest = {
      learnerAnswerChoice: selectedChoice,
    };

    // setSubmitted(true);

    // if (selectedChoice === true) {
    //   setIsCorrect(true);
    //   if (updateStatus) {
    //     updateStatus("correct");
    //   }
    // } else {
    //   setIsCorrect(false);
    //   if (updateStatus) {
    //     updateStatus("incorrect");
    //   }
    // }
  };

  const renderFeedbackMessage = () => {
    // TODO: make this a component and move it to a separate file
    let feedbackText = "";
    let bgColor = "";
    let borderColor = "";
    let textColor = "";
    let innerCircleColor = "";

    if (submitted) {
      if (isCorrect) {
        feedbackText = "Correct! Well done.";
        bgColor = "bg-emerald-100";
        borderColor = "border-emerald-500";
        textColor = "text-emerald-800";
        innerCircleColor = "bg-emerald-400";
      } else {
        feedbackText = "Incorrect choice.";
        bgColor = "bg-red-100";
        borderColor = "border-red-500";
        textColor = "text-red-800";
        innerCircleColor = "bg-red-400";
      }

      return (
        <div
          className={`w-96 h-16 pl-2 pr-2.5 py-0.5 ${bgColor} rounded-lg ${borderColor} justify-center items-center gap-1.5 inline-flex`}
        >
          <div className="w-2 h-2 relative">
            <div
              className={`w-1.5 h-1.5 left-[1px] top-[1px] absolute ${innerCircleColor} rounded-full`}
            />
          </div>
          <div
            className={`text-center ${textColor} text-base font-medium leading-none`}
          >
            {feedbackText}
          </div>
        </div>
      );
    }

    return null;
  };

  const buttonStyle = (choice: boolean) => {
    if (submitted) {
      if (selectedChoice === choice) {
        return choice === true
          ? "bg-green-100 text-black"
          : "bg-red-100 text-black";
      }
    } else {
      if (selectedChoice === choice) {
        return "bg-blue-100 text-black";
      }
    }
    return "text-black";
  };

  return (
    <>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <InfoLine text={question} />
        <button
          className={`block w-full text-left p-2 mb-2 border rounded ${buttonStyle(
            true
          )}`}
          onClick={() => handleChoiceClick(true)}
          disabled={submitted}
        >
          True
        </button>
        <button
          className={`block w-full text-left p-2 mb-2 border rounded ${buttonStyle(
            false
          )}`}
          onClick={() => handleChoiceClick(false)}
          disabled={submitted}
        >
          False
        </button>
      </div>
      <div className="mt-4 flex flex-col items-center">
        {renderFeedbackMessage()}
        <div className="mt-4">
          <Button
            onClick={handleSubmit}
            disabled={submitted}
            className={
              submitted
                ? "bg-white text-indigo-300 cursor-not-allowed hover:bg-white"
                : "hover:bg-indigo-500"
            }
          >
            Submit Question
          </Button>
        </div>
      </div>
    </>
  );
}

export default TrueFalseQuestion;
