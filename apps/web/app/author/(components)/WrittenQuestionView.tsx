"use client";

// COMMENT: this is the component where we show written question for the author
// this contains "points", and the "rubric table"

// import { Listbox, Menu, RadioGroup, Transition } from "@headlessui/react";
// import {
//   CheckCircleIcon,
//   CheckIcon,
//   ChevronDownIcon,
//   PencilIcon,
//   ViewListIcon,
// } from "@heroicons/react/solid";
import { useAuthorStore } from "@/stores/author";
import { useState } from "react";
import RubricTable from "../../../components/depreciated/RubricTable";
import ExtendableRubricChart from "./ExtendableRubricChart";
import WordCountComponent from "./WordCountComponent";

interface WrittenQuestionViewProps {
  questionId: number;
  handleScore: (event: React.ChangeEvent<HTMLInputElement>) => void;
  score: string;
  switchState: string;
  setSwitchState: React.Dispatch<React.SetStateAction<string>>;
  choicesWrittenQuestion: string[];
  handleChoiceChangeWrittenQuestion: (index: number, value: string) => void;
  handleRemoveChoiceWrittenQuestion: (index: number) => void;
  handleAddChoiceWrittenQuestion: () => void;
  initialRubrics: any;
  onMaxPointsChange: (maxPoints: number) => void; // Define the onMaxPointsChange prop
}

function WrittenQuestionView(props: WrittenQuestionViewProps) {
  const {
    questionId,
    handleScore,
    score,
    switchState,
    setSwitchState,
    handleChoiceChangeWrittenQuestion,
    choicesWrittenQuestion,
    handleRemoveChoiceWrittenQuestion,
    handleAddChoiceWrittenQuestion,
    // initialRubrics,
  } = props;

  const [questions, modifyQuestion] = useAuthorStore((state) => [
    state.questions,
    state.modifyQuestion,
  ]);

  const question = questions.find((question) => question.id === questionId);

  function handleQuestionRetryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    modifyQuestion(questionId, {
      numRetries: ~~e.target.value,
    });
  }

  // COMMENT: here's the state and helper function we use to control the row of the rubric table
  // const [rubrics, setRubrics] = useState(initialRubrics);
  // var maxLength = 1;
  // const handleAddRow = () => {
  // Calculate the index for the new row
  // if (maxLength < rubrics.length + 1) {
  //   maxLength = rubrics.length + 1;
  // }
  // Create a new row object with dynamic criteria
  // const newRow = {
  //   key: maxLength,
  //   criteria: `New Criteria`,
  //   judgement: "",
  //   rate: "",
  //   weight: "",
  // };

  // Add the new row to the initialRubrics array
  // setRubrics([...rubrics, newRow]);
  // };

  // const handleDeleteRow = (index) => {
  //   if (rubrics.length === 1) {
  //     alert("You only have one criteria, so you cannot delete it.");
  //     return;
  //   }

  //   const updatedRubrics = rubrics.filter((_, i) => i !== index);
  //   setRubrics(updatedRubrics);
  // };

  // this code is used to handle maxPoints passed from extendable rubric chart, so we can print points on the top left
  const [parentMaxPoints, setParentMaxPoints] = useState<number | null>(null);

  // Define a function to receive the maxPoints value from the child component
  const handleMaxPointsChange = (maxPoints: number) => {
    setParentMaxPoints(maxPoints);
  };
  props.onMaxPointsChange(parentMaxPoints);
  return (
    <>
      <div className="grid grid-cols-2 gap-x-16">
        <WordCountComponent text="Maximum Word Count  " />
        <div className="flex flex-col gap-y-1">
          <label className="font-medium leading-5 text-gray-800">
            Number of Retries Per Submission
          </label>
          <select
            className="border border-gray-300 rounded-md h-12 px-4 w-full"
            name="attempts"
            onChange={handleQuestionRetryChange}
            value={question?.numRetries || -1}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
            <option value={-1}>unlimited</option>
          </select>
        </div>
      </div>
      <div className="bg-indigo-100 -mx-12 px-8 flex gap-x-4 py-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="65"
          height="66"
          viewBox="0 0 65 66"
          fill="none"
        >
          <path
            d="M24.4342 32.5332H34.4685M24.4342 40.6582H34.4685M24.4342 48.7832H34.4685M42.496 50.8145H48.5166C50.1134 50.8145 51.6447 50.1724 52.7738 49.0296C53.9029 47.8868 54.5372 46.3369 54.5372 44.7207V16.5757C54.5372 13.5017 52.2762 10.8936 49.2498 10.639C48.249 10.555 47.2473 10.4828 46.2448 10.4224M46.2448 10.4224C46.4224 11.0049 46.5099 11.6111 46.5098 12.2207C46.5098 12.7594 46.2983 13.2761 45.922 13.657C45.5456 14.0379 45.0351 14.252 44.5029 14.252H32.4617C31.3539 14.252 30.4548 13.342 30.4548 12.2207C30.4548 11.5951 30.5485 10.9911 30.7224 10.4224M46.2448 10.4224C45.4876 7.93612 43.1971 6.12695 40.4892 6.12695H36.4754C35.189 6.12726 33.9364 6.54443 32.9012 7.31737C31.866 8.09032 31.1024 9.17843 30.7224 10.4224M30.7224 10.4224C29.7163 10.4847 28.7155 10.5578 27.7148 10.639C24.6884 10.8936 22.4273 13.5017 22.4273 16.5757V22.377M22.4273 22.377H13.3964C11.7348 22.377 10.3861 23.742 10.3861 25.4238V55.8926C10.3861 57.5745 11.7348 58.9395 13.3964 58.9395H39.4857C41.1474 58.9395 42.496 57.5745 42.496 55.8926V25.4238C42.496 23.742 41.1474 22.377 39.4857 22.377H22.4273ZM18.4136 32.5332H18.435V32.5549H18.4136V32.5332ZM18.4136 40.6582H18.435V40.6799H18.4136V40.6582ZM18.4136 48.7832H18.435V48.8049H18.4136V48.7832Z"
            stroke="#1D4ED8"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <div className="flex-1">
          <div
            style={{
              color: "#1D4ED8",
              fontSize: "1.19825rem",
              fontWeight: 600,
            }}
          >
            Rubric
          </div>
          <div
            className=""
            style={{
              width: 900,
              color: "#4B5563",
              textAlign: "left",
              fontSize: 13.17,
            }}
          >
            Set up a rubric to define how the paragraph should be graded. MARK
            handles grading, saving you time. Learner submit paragraphs, and
            MARK provides feedback and grades based on the rubric.
          </div>
        </div>
      </div>
      {/* <p className="mt-[10px]">Points:</p>
      <input
        type="number"
        className="p-2 border rounded-md w-[200px] mt-[15px] text-gray-700 bg-transparent outline-none border-gray-300"
        placeholder={`ex. 10`}
        value={score}
        onChange={handleScore}
        min={1}
        max={100}
        style={{
          maxWidth: "100%",
        }}
      /> */}
      {/* <div className="flex items-center">
        <label className="switch">
          <button
            className={`text-black bg-white hover:bg-white focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center dark:bg-white dark:hover:bg-gray-300 ${
              switchState === "a" ? "bg-blue-800" : ""
            }`}
            onClick={() => setSwitchState("a")}
          >
            Single Criteria (easy mode)
          </button>

          <button
            className={`text-black bg-white hover:bg-white focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center dark:bg-white dark:hover:bg-gray-300 ${
              switchState === "b" ? "bg-blue-800" : ""
            }`}
            onClick={() => setSwitchState("b")}
          >
            Multiple Criteria (Pro Mode)
          </button>

          <span className="slider round"></span>
        </label>
      </div> */}

      {/* Render the child component and pass the handleMaxPointsChange function as a prop */}
      <ExtendableRubricChart
        questionId={questionId}
        onMaxPointsChange={handleMaxPointsChange}
      />

      {/* {switchState === "b" && (
        // <RubricTable
        //   rubrics={rubrics}
        //   onAddRow={handleAddRow}
        //   onDeleteRow={handleDeleteRow}
        //   setRubrics={setRubrics}
        // />
      )} */}
    </>
  );
}
export default WrittenQuestionView;
