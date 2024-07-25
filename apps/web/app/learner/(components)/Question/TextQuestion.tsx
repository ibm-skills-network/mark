import { useLearnerStore } from "@/stores/learner";
import MarkdownEditor from "@components/MarkDownEditor";

interface Props {}

function TextQuestion(props: Props) {
  const {} = props;
  const activeQuestionNumber = useLearnerStore(
    (state) => state.activeQuestionNumber,
  );

  const [questions, setTextResponse] = useLearnerStore((state) => [
    state.questions,
    state.setTextResponse,
  ]);

  const question = questions[activeQuestionNumber - 1];

  const maxWords = question?.maxWords || null;
  return (
    <MarkdownEditor
      value={question?.learnerTextResponse || ""}
      // update status
      setValue={(value) => setTextResponse(value)}
      placeholder="Type your answer here"
      maxWords={maxWords}
    />
  );
}

export default TextQuestion;
