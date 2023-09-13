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
import { useState } from "react";
import ExtendableRubricChart from "./ExtendableRubricChart";
import RubricTable from "./RubricTable";
import WordCountComponent from "./WordCountComponent";

interface WrittenQuestionViewProps {
  handleScore: any;
  score: any;
  switchState: any;
  setSwitchState: any;
  choicesWrittenQuestion: any;
  handleChoiceChangeWrittenQuestion: any;
  handleRemoveChoiceWrittenQuestion: any;
  handleAddChoiceWrittenQuestion: any;
  initialRubrics: any;
}

function WrittenQuestionView(props: WrittenQuestionViewProps) {
  const {
    handleScore,
    score,
    switchState,
    setSwitchState,
    handleChoiceChangeWrittenQuestion,
    choicesWrittenQuestion,
    handleRemoveChoiceWrittenQuestion,
    handleAddChoiceWrittenQuestion,
    initialRubrics,
  } = props;

  // COMMENT: here's the state and helper function we use to control the row of the rubric table
  const [rubrics, setRubrics] = useState(initialRubrics);
  var maxLength = 1;
  const handleAddRow = () => {
    // Calculate the index for the new row
    if (maxLength < rubrics.length + 1) {
      maxLength = rubrics.length + 1;
    }
    // Create a new row object with dynamic criteria
    const newRow = {
      key: maxLength,
      criteria: `New Criteria`,
      judgement: "",
      rate: "",
      weight: "",
    };

    // Add the new row to the initialRubrics array
    setRubrics([...rubrics, newRow]);
  };

  const handleDeleteRow = (index) => {
    if (rubrics.length === 1) {
      alert("You only have one criteria, so you cannot delete it.");
      return;
    }

    const updatedRubrics = rubrics.filter((_, i) => i !== index);
    setRubrics(updatedRubrics);
  };

  return (
    <div className="mt-4">
      <WordCountComponent text="Minimum & Maximum Word Count  " />
      <div
        className="w-auto h-[104px] rounded-lg"
        style={{ background: "#E0E7FF" }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="65"
          height="66"
          viewBox="0 0 65 66"
          fill="none"
          style={{ transform: "translate(10px, 15px)" }} // Adjust the values as needed
        >
          <path
            d="M24.4342 32.5332H34.4685M24.4342 40.6582H34.4685M24.4342 48.7832H34.4685M42.496 50.8145H48.5166C50.1134 50.8145 51.6447 50.1724 52.7738 49.0296C53.9029 47.8868 54.5372 46.3369 54.5372 44.7207V16.5757C54.5372 13.5017 52.2762 10.8936 49.2498 10.639C48.249 10.555 47.2473 10.4828 46.2448 10.4224M46.2448 10.4224C46.4224 11.0049 46.5099 11.6111 46.5098 12.2207C46.5098 12.7594 46.2983 13.2761 45.922 13.657C45.5456 14.0379 45.0351 14.252 44.5029 14.252H32.4617C31.3539 14.252 30.4548 13.342 30.4548 12.2207C30.4548 11.5951 30.5485 10.9911 30.7224 10.4224M46.2448 10.4224C45.4876 7.93612 43.1971 6.12695 40.4892 6.12695H36.4754C35.189 6.12726 33.9364 6.54443 32.9012 7.31737C31.866 8.09032 31.1024 9.17843 30.7224 10.4224M30.7224 10.4224C29.7163 10.4847 28.7155 10.5578 27.7148 10.639C24.6884 10.8936 22.4273 13.5017 22.4273 16.5757V22.377M22.4273 22.377H13.3964C11.7348 22.377 10.3861 23.742 10.3861 25.4238V55.8926C10.3861 57.5745 11.7348 58.9395 13.3964 58.9395H39.4857C41.1474 58.9395 42.496 57.5745 42.496 55.8926V25.4238C42.496 23.742 41.1474 22.377 39.4857 22.377H22.4273ZM18.4136 32.5332H18.435V32.5549H18.4136V32.5332ZM18.4136 40.6582H18.435V40.6799H18.4136V40.6582ZM18.4136 48.7832H18.435V48.8049H18.4136V48.7832Z"
            stroke="#1D4ED8"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <div
          style={{
            width: 223.17,
            color: "#1D4ED8",
            fontSize: 16.17,
            fontWeight: "",
            transform: "translate(5px, -50px)", // Adjust the vertical value as needed
            textAlign: "center",
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
            transform: "translate(90px, -45px)", // Adjust the vertical value as needed
          }}
        >
          Set up a rubric to define how the paragraph should be graded. MARK
          handles grading, saving you time. <br /> Students submit paragraphs,
          and MARK provides feedback and grades based on the rubric.
        </div>
      </div>
      <p className="mt-[10px]">Points:</p>
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
      />
      <div className="flex items-center">
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
      </div>

      {switchState === "a" && <ExtendableRubricChart />}

      {switchState === "b" && (
        <RubricTable
          rubrics={rubrics}
          onAddRow={handleAddRow}
          onDeleteRow={handleDeleteRow}
          setRubrics={setRubrics}
        />
      )}
    </div>
  );
}
export default WrittenQuestionView;
