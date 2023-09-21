import type { Question, QuestionStatus, QuestionStore } from "@/config/types";
import { useLearnerStore } from "@/stores/learner";
import MarkdownEditor from "@components/MarkDownEditor";

interface Props {
  questionData?: QuestionStore;
  updateStatus: (status: QuestionStatus) => void;
}

function TextQuestion(props: Props) {
  const { questionData, updateStatus } = props;
  const { question, totalPoints } = questionData;
  const activeQuestionId = useLearnerStore((state) => state.activeQuestionId);

  const [questions, setTextResponse] = useLearnerStore((state) => [
    state.questions,
    state.setTextResponse,
  ]);

  const maxWords = 5;
  return (
    <>
      <p className="mb-4 text-gray-700">{question}</p>
      <MarkdownEditor
        value={questions[activeQuestionId]?.learnerTextResponse || ""}
        setValue={(value) => setTextResponse(value)}
        maxWords={maxWords}
      />
    </>
  );
}

export default TextQuestion;
