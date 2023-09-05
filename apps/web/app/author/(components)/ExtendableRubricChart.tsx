import MarkdownEditor from "@/components/MarkDownEditor";
import React, { useState } from "react";

interface ExtendableRubricChartProps {}

function ExtendableRubricChartProps(props: ExtendableRubricChartProps) {
  // Step 1: State Management
  const [divElements, setDivElements] = useState<number[]>([]);
  const [promptOptions, setPromptOptions] = useState<{
    [key: number]: string[];
  }>({});
  // New state for promptPoints as a matrix
  const [promptPoints, setPromptPoints] = useState<{
    [key: number]: number[][];
  }>({});

  // Step 2: Add Button Handler
  const handleAddDiv = () => {
    const newDivKey = Date.now();
    setDivElements([...divElements, newDivKey]);
    setPromptOptions({ ...promptOptions, [newDivKey]: [] });
    // Initialize an empty matrix for promptPoints for the new divKey
    setPromptPoints({ ...promptPoints, [newDivKey]: [] });
  };

  // Step 3: Delete Button Handler
  const handleDeleteDiv = (divKeyToDelete: number) => {
    const updatedDivElements = divElements.filter(
      (key) => key !== divKeyToDelete
    );
    setDivElements(updatedDivElements);
    const { [divKeyToDelete]: _, ...updatedPromptOptions } = promptOptions;
    setPromptOptions(updatedPromptOptions);
    const { [divKeyToDelete]: __, ...updatedPromptPoints } = promptPoints;
    setPromptPoints(updatedPromptPoints);
  };

  const handleRemoveChoiceWrittenQuestion = (divKey: number, index: number) => {
    const updatedChoices = promptOptions[divKey].filter((_, i) => i !== index);
    setPromptOptions({ ...promptOptions, [divKey]: updatedChoices });
    // Also remove the corresponding column from the promptPoints matrix
    const updatedPoints = promptPoints[divKey].map((row) =>
      row.filter((_, i) => i !== index)
    );
    setPromptPoints({ ...promptPoints, [divKey]: updatedPoints });
  };

  const handleChoiceChangeWrittenQuestion = (
    divKey: number,
    index: number,
    value: string
  ) => {
    const updatedChoices = [...promptOptions[divKey]];
    updatedChoices[index] = value;
    setPromptOptions({ ...promptOptions, [divKey]: updatedChoices });
  };

  const handleAddChoiceWrittenQuestion = (divKey: number) => {
    setPromptOptions({
      ...promptOptions,
      [divKey]: [...(promptOptions[divKey] || []), ""],
    });
    // Add a default value of 0 for the new column in the promptPoints matrix
    const updatedPoints = promptPoints[divKey].map((row) => [...row, 0]);
    setPromptPoints({ ...promptPoints, [divKey]: updatedPoints });
  };

  // New handler for changing promptPoints
  const handlePromptPoints = (
    divKey: number,
    colIndex: number,
    value: number
  ) => {
    const updatedPoints = [...promptPoints[divKey]];
    updatedPoints[divKey][colIndex] = value;
    setPromptPoints({ ...promptPoints, [divKey]: updatedPoints });
  };

  return (
    <div>
      {divElements.map((divKey) => (
        <div
          key={divKey}
          className={`relative flex flex-col pl-2 mt-[60px] rounded-md p-4 mx-auto my-auto bg-white border-l-8 rounded-md p-10 border-blue-500`}
        >
          <p> Total Points</p>
          <p> Point Adjustment</p>
          <button
            className="bg-red-500 text-white p-2 rounded-md mt-2"
            onClick={() => handleDeleteDiv(divKey)}
          >
            Delete
          </button>
          <div>
            <div className="w-96 h-11 px-6 py-3 bg-gray-100 justify-start items-center inline-flex">
              <div className="text-gray-800 text-base font-medium capitalize leading-tight">
                Write the first Criteria Question 1 will be graded upon
              </div>
            </div>
            <MarkdownEditor
              value={"" as string}
              textareaClassName="!min-h-[6.5rem] !max-h-72"
              className=""
              setValue={function (value: string): void {
                throw new Error("Function not implemented.");
              }}
            />
          </div>
          <div>
            <p>Point distribution for the Rubric</p>
            {promptOptions[divKey].map((choice, index) => (
              <div key={index} className="flex items-center">
                {/* Add input for promptPoints */}
                <input
                  type="number"
                  className="p-2 border rounded-md w-[50px] mt-[15px] text-gray-700 bg-transparent outline-none"
                  placeholder={`Points`}
                  value={promptPoints[divKey][index]}
                  onChange={(event) =>
                    handlePromptPoints(divKey, index, event.target.value)
                  }
                  min={1}
                  max={100}
                  style={{
                    maxWidth: "100%",
                  }}
                />
                <input
                  type="text"
                  className="p-2 rounded-md text-black bg-transparent outline-none w-full"
                  placeholder={`Choice ${index + 1}`}
                  value={choice}
                  onChange={(event) =>
                    handleChoiceChangeWrittenQuestion(
                      divKey,
                      index,
                      event.target.value
                    )
                  }
                  style={{
                    height: "2.125rem",
                    maxWidth: "100%",
                  }}
                />
                <button
                  className="ml-2 text-red-600"
                  onClick={() =>
                    handleRemoveChoiceWrittenQuestion(divKey, index)
                  }
                >
                  {/* Remove choice */}
                </button>
              </div>
            ))}
            <button
              className="bg-blue-500 text-white p-2 rounded-md mt-2"
              onClick={() => handleAddChoiceWrittenQuestion(divKey)}
            >
              Add Option
            </button>
          </div>
        </div>
      ))}
      <button
        className="bg-red-500 text-white p-2 rounded-md mt-2"
        onClick={handleAddDiv}
      >
        Add Propmt Part
      </button>
    </div>
  );
}

export default ExtendableRubricChartProps;
