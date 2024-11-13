import { QuestionStore } from "@/config/types";
import { type FC } from "react";
import FileUploadSection from "./FileUploadSection";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import TextQuestion from "./TextQuestion";
import TrueFalseQuestion from "./TrueFalseQuestion";
import UrlQuestion from "./UrlQuestion";

interface Props {
  questionType: string;
  question: QuestionStore;
}

const RenderQuestion: FC<Props> = (props) => {
  const { questionType, question } = props;
  switch (questionType) {
    case "TEXT":
      return <TextQuestion question={question} />;
    case "SINGLE_CORRECT":
      return (
        <MultipleChoiceQuestion isSingleCorrect={true} question={question} />
      );
    case "MULTIPLE_CORRECT":
      return (
        <MultipleChoiceQuestion isSingleCorrect={false} question={question} />
      );
    case "TRUE_FALSE":
      return <TrueFalseQuestion question={question} />;
    case "URL":
      return <UrlQuestion question={question} />;
    case "UPLOAD":
    case "IMAGES":
    case "CODE":
      return (
        <FileUploadSection
          questionId={question.id}
          questionType={questionType}
        />
      );
    default:
      return null;
  }
};

export default RenderQuestion;
