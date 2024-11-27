import { QuestionStore, QuestionType } from "@/config/types";
import { type FC } from "react";
import FileUploadSection from "./FileUploadSection";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import TextQuestion from "./TextQuestion";
import TrueFalseQuestion from "./TrueFalseQuestion";
import UrlQuestion from "./UrlQuestion";
import FileLinkUploadSection from "./FileLinkUploadSection";
import { useLearnerStore } from "@/stores/learner";

interface Props {
  questionType: QuestionType;
  question: QuestionStore;
}

const RenderQuestion: FC<Props> = (props) => {
  const { questionType, question } = props;
  const onModeChange = useLearnerStore((state) => state.onModeChange);
  const onFileChange = useLearnerStore((state) => state.onFileChange);
  const onUrlChange = useLearnerStore((state) => state.onUrlChange);

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
      return <UrlQuestion question={question} onUrlChange={onUrlChange} />;
    case "UPLOAD":
    case "IMAGES":
    case "CODE":
      return (
        <FileUploadSection
          questionId={question.id}
          questionType={questionType}
          responseType={question.responseType}
          onFileChange={onFileChange}
        />
      );
    case "LINK_FILE":
      return (
        <FileLinkUploadSection
          questionId={question.id}
          questionType={questionType}
          responseType={question.responseType}
          question={question}
          onModeChange={onModeChange}
        />
      );
    default:
      return null;
  }
};

export default RenderQuestion;
