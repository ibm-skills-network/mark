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
          <div style={{ position: "relative" }}>
            <button
              className="absolute top-0 right-0 m-2 text-red-600"
              onClick={() => handleDeleteDiv(divKey)}
            >
              X
            </button>
          </div>

          <div className="flex flex-col w-full border-black">
            <div className="w-full h-[80px] px-6 py-3 bg-gray-200 justify-start items-center inline-flex">
              <div className="text-gray-800 text-base font-medium capitalize h-[30px] leading-tight">
                Write the first Criteria Question 1 will be graded upon
              </div>
            </div>

            <input
              type="text"
              value={"" as string}
              placeholder={`ex. “is the question legible?”`}
              onChange={(event) =>
                function (value: string): void {
                  throw new Error("Function not implemented.");
                }
              }
              className="w-full h-[200px] p-2 border rounded-md text-gray-700 bg-transparent outline-none"
              style={{
                maxWidth: "100%",
              }}
            />
          </div>

          <div>
            <h1 className="text-base font-normal mt-[10px] leading-6 text-gray-900 relative">
              Below write the conditions for the Criteria above
              <span className="absolute -top-1 left-38 text-blue-400">*</span>
            </h1>
            {promptOptions[divKey].map((choice, index) => (
              <div key={index} className="flex items-center mt-[10px]">
                {/* Add input for promptPoints */}
                <div className="flex items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="15"
                    viewBox="0 0 14 15"
                    fill="none"
                  >
                    <rect
                      y="0.516602"
                      width="14"
                      height="14"
                      rx="7"
                      fill="#E5E7EB"
                    />
                  </svg>
                  <input
                    type="number"
                    className="p-2 border ml-[10px] rounded-md h-[3.256rem] w-[100px] text-gray-700 bg-transparent outline-none"
                    placeholder={`ex. ${index}`}
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
                    className="p-2 rounded-md ml-[10px] w-[750px] h-[3.256rem] text-black bg-transparent outline-none"
                    placeholder={`Prompt Option ${
                      index + 1
                    } ex. “The question not legible” `}
                    value={choice}
                    onChange={(event) =>
                      handleChoiceChangeWrittenQuestion(
                        divKey,
                        index,
                        event.target.value
                      )
                    }
                    style={{
                      maxWidth: "100%",
                    }}
                  />
                </div>

                <button
                  className="ml-2 text-red-600"
                  onClick={() =>
                    handleRemoveChoiceWrittenQuestion(divKey, index)
                  }
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z"
                    />
                  </svg>
                </button>
              </div>
            ))}
            <button
              className="bg-gray-100 w-[70px] text-black p-2 rounded-md mt-2"
              onClick={() => handleAddChoiceWrittenQuestion(divKey)}
            >
              Add Option
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
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
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
