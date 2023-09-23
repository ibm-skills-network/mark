import { QuestionStatus } from "@/config/types";
import { useLearnerStore } from "@/stores/learner";
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
  const question = useLearnerStore((state) => state.questions[0]);
  function updateStatus(status: QuestionStatus) {
    console.log("status", status);
  }
  switch (questionType) {
    case "TEXT":
      return <TextQuestion />;
    // case "SINGLE_CORRECT":
    //   // removed singleCorrect
    //   return (
    //     <MultipleChoiceQuestion
    //       questionData={question}
    //       updateStatus={updateStatus}
    //     />
    //   );
    // case "MULTIPLE_CORRECT":
    //   return (
    //     <MultipleChoiceQuestion
    //       questionData={question}
    //       updateStatus={updateStatus}
    //     />
    //   );
    // case "TRUE_FALSE":
    //   return (
    //     <TrueFalseQuestion
    //       questionData={question}
    //       updateStatus={updateStatus}
    //     />
    //   );
    // case "URL":
    //   return (
    //     <UrlQuestion questionData={question} updateStatus={updateStatus} />
    //   );
    // case "UPLOAD":
    //   return (
    //     <UploadQuestion questionData={question} updateStatus={updateStatus} />
    //   );
    default:
      return null;
  }
};

export default RenderQuestion;
