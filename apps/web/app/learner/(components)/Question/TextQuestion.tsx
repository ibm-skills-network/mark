import { QuestionStore } from "@/config/types";
import { useLearnerStore } from "@/stores/learner";
import MarkdownEditor from "@components/MarkDownEditor";

interface Props {
  question: QuestionStore;
}

function TextQuestion(props: Props) {
  const { question } = props;
  const [setTextResponse] = useLearnerStore((state) => [state.setTextResponse]);

  const maxWords = question?.maxWords || null;
  const maxCharacters = question?.maxCharacters || null;

  return (
    <MarkdownEditor
      value={question?.learnerTextResponse || ""}
      setValue={(value) => setTextResponse(value, question.id)}
      placeholder="Type your answer here"
      maxWords={maxWords}
      maxCharacters={maxCharacters}
    />
  );
}

export default TextQuestion;
