import type { Question } from "@/config/types";
import { twMerge } from "tailwind-merge";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import TextQuestion from "./TextQuestion";
import TrueFalseQuestion from "./TrueFalseQuestion";
import UploadQuestion from "./UploadQuestion";
import UrlQuestion from "./UrlQuestion";

interface Props extends React.ComponentPropsWithoutRef<"section"> {
  question: Question;
  questionNumber: number;
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
          />
        );
      case "SINGLE_CORRECT":
        return <MultipleChoiceQuestion questionData={question} singleCorrect />;
      case "MULTIPLE_CORRECT":
        return <MultipleChoiceQuestion questionData={question} />;
      case "TRUE_FALSE":
        return <TrueFalseQuestion questionData={question} />;
      case "URL":
        return <UrlQuestion questionData={question} />;
      case "UPLOAD":
        return <UploadQuestion questionData={question} />;
      default:
        return null;
    }
  }

  return (
    <section className={twMerge("", className)}>
      <p>
        Question {questionNumber}: Points {totalPoints.toFixed(2)} out of 100
      </p>
      {RenderQuestion()}
    </section>
  );
}

export default Component;
