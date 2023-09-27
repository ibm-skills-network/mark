import type { Question, QuestionStatus, QuestionStore } from "@/config/types";
import { ComponentPropsWithoutRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import Button from "../Button";
import RenderQuestion from "./RenderQuestion";

interface Props extends ComponentPropsWithoutRef<"section"> {
  question: QuestionStore;
  questionNumber: number;
  updateStatus?: (status: QuestionStatus) => void;
}

function Component(props: Props) {
  const { question, className, questionNumber } = props;

  const { type, totalPoints } = question;
  const [submitted, setSubmitted] = useState<boolean>(false);

  function handleSubmit() {
    // setSubmitted(true);
    // updateStatus("edited");
  }

  return (
    <section className={twMerge("", className)} key={question.id}>
      <div className="space-x-1">
        <span className="text-gray-600 text-xl font-medium leading-tight">
          Question {questionNumber}:
        </span>
        <span className="text-blue-700 text-base font-medium leading-tight">
          {totalPoints.toFixed(2)} Points
        </span>
      </div>
      <div className="mb-4 bg-white p-9 rounded-lg border border-gray-300">
        <p className="mb-4 text-gray-700">{question.question}</p>
        <RenderQuestion questionType={type} />
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
