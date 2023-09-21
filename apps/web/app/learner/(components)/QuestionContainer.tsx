import type { Question, QuestionStatus, QuestionStore } from "@/config/types";
import { useState } from "react";
import { twMerge } from "tailwind-merge";
import Button from "./Button";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import TextQuestion from "./TextQuestion";
import TrueFalseQuestion from "./TrueFalseQuestion";
import UploadQuestion from "./UploadQuestion";
import UrlQuestion from "./UrlQuestion";

interface Props extends React.ComponentPropsWithoutRef<"section"> {
  question: QuestionStore;
  questionNumber: number;
  updateStatus?: (status: QuestionStatus) => void;
}

function Component(props: Props) {
  const { question, className, questionNumber, updateStatus } = props;

  const { type, totalPoints } = question;
  const [submitted, setSubmitted] = useState<boolean>(false);

  function handleSubmit() {
    setSubmitted(true);
    updateStatus("edited");

    // const data = await submitQuestionResponse(
    //   1,
    //   1,
    //   id,
    //   {learnerTextResponse: answer},
    // )
  }

  function RenderQuestion(): JSX.Element | null {
    switch (type) {
      case "TEXT":
        return (
          <TextQuestion questionData={question} updateStatus={updateStatus} />
        );
      case "SINGLE_CORRECT":
        // removed singleCorrect
        return (
          <MultipleChoiceQuestion
            questionData={question}
            updateStatus={updateStatus}
          />
        );
      case "MULTIPLE_CORRECT":
        return (
          <MultipleChoiceQuestion
            questionData={question}
            updateStatus={updateStatus}
          />
        );
      case "TRUE_FALSE":
        return (
          <TrueFalseQuestion
            questionData={question}
            updateStatus={updateStatus}
          />
        );
      case "URL":
        return (
          <UrlQuestion questionData={question} updateStatus={updateStatus} />
        );
      case "UPLOAD":
        return (
          <UploadQuestion questionData={question} updateStatus={updateStatus} />
        );
      default:
        return null;
    }
  }

  return (
    <section className={twMerge("", className)}>
      <div className="space-x-1">
        <span className="text-gray-600 text-xl font-medium leading-tight">
          Question {questionNumber}:
        </span>
        <span className="text-blue-700 text-base font-medium leading-tight">
          {totalPoints.toFixed(2)} Points
        </span>
      </div>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <RenderQuestion />
      </div>
      <div className="flex justify-center mt-4">
        <Button className=" " onClick={handleSubmit}>
          Submit Question
        </Button>
      </div>
    </section>
  );
}

export default Component;
