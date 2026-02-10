import { QuestionStore } from "@/config/types";
import {
  useLearnerStore,
  useAssignmentDetails,
  useLearnerOverviewStore,
} from "@/stores/learner";
import MarkdownEditor from "@components/MarkDownEditor";
import { useAutoSaveResponse } from "@/hooks/use-auto-save-response";

interface Props {
  question: QuestionStore;
}

function TextQuestion(props: Props) {
  const { question } = props;
  const [setTextResponse, activeAttemptId] = useLearnerStore((state) => [
    state.setTextResponse,
    state.activeAttemptId,
  ]);
  const assignmentDetails = useAssignmentDetails(
    (state) => state.assignmentDetails,
  );
  const assignmentId = useLearnerOverviewStore((state) => state.assignmentId);
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
