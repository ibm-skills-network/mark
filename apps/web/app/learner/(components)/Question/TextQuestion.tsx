import { QuestionStore } from "@/config/types";
import { useLearnerStore, useAssignmentDetails } from "@/stores/learner";
import MarkdownEditor from "@components/MarkDownEditor";

interface Props {
  question: QuestionStore;
}

function TextQuestion(props: Props) {
  const { question } = props;
  const [setTextResponse] = useLearnerStore((state) => [
    state.setTextResponse,
    state.activeAttemptId,
  ]);
  const assignmentDetails = useAssignmentDetails(
    (state) => state.assignmentDetails,
  );
  const questionControls = assignmentDetails?.questionControls;

  const maxWords = question?.maxWords || null;
  const maxCharacters = question?.maxCharacters || null;

  // useAutoSaveResponse(assignmentId, activeAttemptId, question.id, {
  //   enabled: true,
  //   debounceMs: 3000,
  // });

  return (
    <MarkdownEditor
      value={question?.learnerTextResponse || ""}
      setValue={(value) => setTextResponse(value, question.id)}
      placeholder="Type your answer here"
      maxWords={maxWords}
      maxCharacters={maxCharacters}
      allowCopy={!(questionControls?.disableCopy ?? false)}
    />
  );
}

export default TextQuestion;
