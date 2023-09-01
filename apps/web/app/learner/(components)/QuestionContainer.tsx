import type { Question, QuestionStatus } from "@/config/types";
import { twMerge } from "tailwind-merge";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import TextQuestion from "./TextQuestion";
import TrueFalseQuestion from "./TrueFalseQuestion";
import UploadQuestion from "./UploadQuestion";
import UrlQuestion from "./UrlQuestion";

interface Props extends React.ComponentPropsWithoutRef<"section"> {
  question: Question;
  questionNumber: number;
  updateStatus: (QuestionStatus) => void;
}

function Component(props: Props) {
  const { question, className, questionNumber } = props;

  const { type, totalPoints } = question;

  function RenderQuestion() {
    switch (type) {
      case "TEXT":
        return (
          <TextQuestion
            questionData={question}
            questionNumber={questionNumber}
            updateStatus={props.updateStatus}
          />
        );
      case "SINGLE_CORRECT":
        // removed singleCorrect
        return (
          <MultipleChoiceQuestion
            questionData={question}
            updateStatus={props.updateStatus}
          />
        );
      case "MULTIPLE_CORRECT":
        return (
          <MultipleChoiceQuestion
            questionData={question}
            updateStatus={props.updateStatus}
          />
        );
      case "TRUE_FALSE":
        return (
          <TrueFalseQuestion
            questionData={question}
            updateStatus={props.updateStatus}
          />
        );
      case "URL":
        return (
          <UrlQuestion
            questionData={question}
            updateStatus={props.updateStatus}
          />
        );
      case "UPLOAD":
        return (
          <UploadQuestion
            questionData={question}
            updateStatus={props.updateStatus}
          />
        );
      default:
        return null;
    }
  }

  return (
    <section className={twMerge("", className)}>
      <div className="w-96">
        <span className="text-gray-600 text-xl font-medium leading-tight">
          {" "}
          Question {questionNumber}:
        </span>
        <span className="text-gray-500 text-xl font-medium leading-tight">
          {" "}
        </span>
        <span className="text-blue-700 text-base font-medium leading-tight">
          {totalPoints.toFixed(2)} Points
        </span>
      </div>

      {RenderQuestion()}
    </section>
  );
}

export default Component;
