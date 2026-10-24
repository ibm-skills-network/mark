import { QuestionStore, QuestionType } from "@/config/types";
import { useUiTranslation } from "@/hooks/use-ui-translation";
import {
  isUnsupportedQuestion,
  UNSUPPORTED_QUESTION_NOTICE,
} from "@/lib/unsupported-questions";
import { useLearnerStore } from "@/stores/learner";
import { type FC } from "react";
import FileLinkUploadSection from "./FileLinkUploadSection";
import FileUploadSection from "./FileUploadSection";
import MultipleChoiceQuestion from "./MultipleChoiceQuestion";
import TextQuestion from "./TextQuestion";
import TrueFalseQuestion from "./TrueFalseQuestion";
import UrlQuestion from "./UrlQuestion";

interface Props {
  questionType: QuestionType;
  question: QuestionStore;
}

const RenderQuestion: FC<Props> = (props) => {
  const { questionType, question } = props;
  const onModeChange = useLearnerStore((state) => state.onModeChange);
  const onUrlChange = useLearnerStore((state) => state.onUrlChange);
  const removeFileUpload = useLearnerStore((state) => state.removeFileUpload);
  const onFileChange = useLearnerStore((state) => state.onFileChange);
  const { t } = useUiTranslation();

  if (isUnsupportedQuestion(question)) {
    return (
      <p
        role="note"
        className="w-full rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
      >
        {t(UNSUPPORTED_QUESTION_NOTICE)}
      </p>
    );
  }

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
      return (
        <FileUploadSection
          question={question}
          responseType={question.responseType}
          onFileChange={onFileChange}
          removeFileUpload={removeFileUpload}
        />
      );

    case "CODE":
      return (
        <FileUploadSection
          question={question}
          responseType={question.responseType}
          onFileChange={onFileChange}
          removeFileUpload={removeFileUpload}
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
