import { useAuthorStore } from "@/stores/author";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { type KeyboardEvent } from "react";

interface Rubric {
  questionId: number;
}

function Rubric(props: Rubric) {
  const { questionId } = props;
  // Step 1: State Management
  const [questions, modifyQuestion, addCriteria, removeCriteria, setCriterias] =
    useAuthorStore((state) => [
      state.questions,
      state.modifyQuestion,
      state.addCriteria,
      state.removeCriteria,
      state.setCriterias,
    ]);
  const { scoring } = questions.find((question) => question.id === questionId);
  // TODO: I know that this is gonna create bugs in the future (when users refresh)
  // TODO: this needs to change depending on the question type
  // for each question, we first try to get the criteria from the question and if it doesn't exist, we create a new one
  const criterias = scoring?.criteria;
  // Initialize the promptOptions state with two default rubric options

  // const [promptOptions, setPromptOptions] =
  //   useState<promptOption[]>(initialPromptOptions);
  const handleRemoveChoiceWrittenQuestion = (indexToRemove: number) => {
    removeCriteria(questionId, indexToRemove);
  };

  const handleChoiceChangeWrittenQuestion = (index: number, value: string) => {
    const newCriterias = [
      ...criterias.slice(0, index),
      { ...criterias[index], description: value },
      ...criterias.slice(index + 1),
    ];
    setCriterias(questionId, newCriterias);
  };

  const handleAddChoiceWrittenQuestion = () => {
    addCriteria(questionId, {
      id:
        (criterias?.reduce(
          (maxId, criteria) => Math.max(criteria.id, maxId),
          0,
        ) || 0) + 1,
      points: criterias.at(-1)?.points + 1 || 0,
      description: "",
    });
  };

  const handlePromptPoints = (index: number, value: string) => {
    const newCriterias = [
      ...criterias.slice(0, index),
      { ...criterias[index], points: ~~value },
      ...criterias.slice(index + 1),
    ];
    setCriterias(
      questionId,
      // sort by points then by id (increasing)
      newCriterias.sort((a, b) => {
        if (a.points === b.points) {
          return a.id - b.id;
        }
        return a.points - b.points;
      }),
    );
  };

  // This function is used to auto adjust the height of the textarea when the user types multiple lines of text
  function textAreaAdjust(e: KeyboardEvent<HTMLTextAreaElement>) {
    const element = e.target as HTMLTextAreaElement;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }
  const [parent, enableAnimations] = useAutoAnimate();

  return (
    <div className="relative flex flex-col rounded-md bg-white border border-transparent">
      <div>
        <h1 className="text-base font-normal pb-4 leading-6 text-gray-900 relative after:text-blue-400 after:content-['*']">
          List the conditions for meeting the Criteria of Question
        </h1>
        <div className="flex items-center gap-x-2 pb-1">
          <p className="w-24">Points</p> <p> Description</p>
        </div>
        <ul ref={parent} className="flex flex-col gap-3">
          {criterias.map((criteria, index) => (
            <li key={criteria.id} className="flex items-center gap-x-2">
              {/* Add input for promptPoints */}
              <input
                type="integer"
                className="p-2 transition shadow-sm border border-gray-300 rounded-md h-12 w-24 text-gray-700 bg-transparent outline-none"
                placeholder={`ex. ${index}`}
                value={criteria.points}
                onChange={(event) => {
                  if (~~event.target.value > ~~event.target.max) {
                    event.target.value = event.target.max;
                  }
                  handlePromptPoints(index, event.target.value);
                }}
                // the previous' value is the min value of this input
                // min={criterias[index - 1]?.points + 1 || 0}
                min={0}
                max={100}
              />

              <textarea
                onKeyDown={(e) => textAreaAdjust(e)}
                className="transition py-2 border flex-1 border-gray-300 shadow-sm pl-2 h-12 max-h-60 resize-none pr-10 rounded-md text-black outline-none placeholder-gray-400"
                placeholder={
                  index === 0
                    ? `ex. “the answer is not legible” `
                    : `ex. “the answer is legible” `
                }
                value={criteria.description}
                onChange={(event) =>
                  handleChoiceChangeWrittenQuestion(index, event.target.value)
                }
                // style={{
                //   width: "800px",
                //   height: "3.256rem",
                //   overflow: "hidden",
                //   resize: "none",
                // }}
              />

              <button
                className="absolute text-red-400 right-4"
                onClick={() => handleRemoveChoiceWrittenQuestion(index)}
              >
                <XMarkIcon className="w-6 hover:cursor-pointer" />
              </button>
            </li>
          ))}
          <button
            className="bg-gray-100 text-black p-2 rounded-md flex items-center justify-center"
            onClick={() => handleAddChoiceWrittenQuestion()}
          >
            {/* {Add Option} */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="25"
              viewBox="0 0 24 25"
              fill="none"
            >
              <path
                d="M12 6.0166V18.0166M18 12.0166H6"
                stroke="#6B7280"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </ul>
      </div>
    </div>
  );
}

export default Rubric;
