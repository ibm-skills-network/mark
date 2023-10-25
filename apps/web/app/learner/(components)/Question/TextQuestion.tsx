import { useLearnerStore } from "@/stores/learner";
import MarkdownEditor from "@components/MarkDownEditor";

interface Props {}

function TextQuestion(props: Props) {
  const {} = props;
  const activeQuestionNumber = useLearnerStore(
    (state) => state.activeQuestionNumber
  );

  const [questions, setTextResponse] = useLearnerStore((state) => [
    state.questions,
    state.setTextResponse,
  ]);

  // const maxWords = assignmentDetails?.;
  // useEffect(() => {
  //   useLearnerStore.subscribe((state) => {
  //     console.log("state.questions", state.questions);
  //     setText(state.questions[activeQuestionNumber - 1]?.learnerTextResponse);
  //   });
  // }, [activeQuestionNumber]);

  // TODO: get this from the backend
  const maxWords = 1000;
  return (
    <MarkdownEditor
      className=" h-60"
      value={questions[activeQuestionNumber - 1]?.learnerTextResponse || ""}
      // update status
      setValue={(value) => setTextResponse(value)}
      placeholder="Type your answer here"
      maxWords={maxWords}
    />
  );
}

export default TextQuestion;
