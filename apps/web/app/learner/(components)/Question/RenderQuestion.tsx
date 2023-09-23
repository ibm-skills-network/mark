import { type FC } from "react";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import TextQuestion from "./TextQuestion";
import TrueFalseQuestion from "./TrueFalseQuestion";
import UploadQuestion from "./UploadQuestion";
import UrlQuestion from "./UrlQuestion";

interface Props {
  questionType: string;
}

const RenderQuestion: FC<Props> = (props) => {
  const { questionType } = props;
  switch (questionType) {
    case "TEXT":
      return <TextQuestion />;
    case "SINGLE_CORRECT":
      // removed singleCorrect
      return <MultipleChoiceQuestion />;
    case "MULTIPLE_CORRECT":
      return <MultipleChoiceQuestion />;
    case "TRUE_FALSE":
      return <TrueFalseQuestion />;
    case "URL":
      return <UrlQuestion />;
    case "UPLOAD":
      return <UploadQuestion />;
    default:
      return null;
  }
};

export default RenderQuestion;
