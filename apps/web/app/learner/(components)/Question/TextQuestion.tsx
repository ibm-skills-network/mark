import { useState } from "react";
import { QuestionStore } from "@/config/types";
import { useUiTranslation } from "@/hooks/use-ui-translation";
import { TEXT_ANSWER_IMAGE_BLOCKED_MESSAGE } from "@/lib/text-answer-images";
import { useLearnerStore, useAssignmentDetails } from "@/stores/learner";
import MarkdownEditor from "@components/MarkDownEditor";

interface Props {
  question: QuestionStore;
}

function TextQuestion(props: Props) {
  const { question } = props;
  const { t } = useUiTranslation();
  const [imageBlocked, setImageBlocked] = useState(false);
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
    <div>
      <MarkdownEditor
        value={question?.learnerTextResponse || ""}
        setValue={(value) => setTextResponse(value, question.id)}
        placeholder="Type your answer here"
        toolbarMode="learner"
        disableListAutofill
        blockImages
        onImageBlocked={() => setImageBlocked(true)}
        maxWords={maxWords}
        maxCharacters={maxCharacters}
        allowCopy={!(questionControls?.disableCopy ?? false)}
      />
      {imageBlocked ? (
        <p
          role="status"
          data-no-ui-translate="true"
          className="mt-2 text-sm leading-snug text-amber-700 dark:text-amber-400"
        >
          {t(TEXT_ANSWER_IMAGE_BLOCKED_MESSAGE)}
        </p>
      ) : null}
    </div>
  );
}

export default TextQuestion;
