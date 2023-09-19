import React, { useState } from "react";

interface ExtendableRubricChartProps {}

function ExtendableRubricChartProps(props: ExtendableRubricChartProps) {
  ////////////////////////////////////////////////
  // state and handle function for the prompt part
  ////////////////////////////////////////////////
  const [inputValues, setInputValues] = useState<string[]>([]);

  // Function to handle input changes and update the state
  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    divKey: number
  ) => {
    const updatedInputValues = [...inputValues];
    updatedInputValues[divKey] = event.target.value;
    setInputValues(updatedInputValues);
  };

  ////////////////////////////////////////////////
  ////////////////////////////////////////////////

  // Step 1: State Management
  const [divElements, setDivElements] = useState<number[]>([]);
  const [promptOptions, setPromptOptions] = useState<string[]>([]);
  // New state for promptPoints as a matrix
  const [promptPoints, setPromptPoints] = useState<string[]>([]);

  // Step 2: Add Button Handler
  // const handleAddDiv = () => {
  //   const newDivKey = Date.now();
  //   setDivElements([...divElements, newDivKey]);
  //   setPromptOptions({ ...promptOptions, [newDivKey]: [] });
  //   // Initialize an empty matrix for promptPoints for the new divKey
  //   setPromptPoints({ ...promptPoints, [newDivKey]: [] });
  // };

  // Step 3: Delete Button Handler
  // const handleDeleteDiv = (divKeyToDelete: number) => {
  //   const updatedDivElements = divElements.filter(
  //     (key) => key !== divKeyToDelete
  //   );
  //   setDivElements(updatedDivElements);
  //   const { [divKeyToDelete]: _, ...updatedPromptOptions } = promptOptions;
  //   setPromptOptions(updatedPromptOptions);
  //   const { [divKeyToDelete]: __, ...updatedPromptPoints } = promptPoints;
  //   setPromptPoints(updatedPromptPoints);
  // };

  const handleRemoveChoiceWrittenQuestion = (indexToRemove: number) => {
    // Create a copy of the current state
    const updatedChoices = [...promptOptions];

    // Remove the element at the specified index
    updatedChoices.splice(indexToRemove, 1);

    // Update the state with the modified array
    setPromptOptions(updatedChoices);
  };

  const handleChoiceChangeWrittenQuestion = (index: number, value: string) => {
    const updatedChoices = [...promptOptions];
    updatedChoices[index] = value;
    setPromptOptions(updatedChoices);
  };

  const handleAddChoiceWrittenQuestion = () => {
    // Create a new input (e.g., an empty string)
    const newChoice = "";

    // Update the state by adding the new input to the end of the PromptOptions array
    setPromptOptions([...promptOptions, newChoice]);
  };

  // New handler for changing promptPoints
  const handlePromptPoints = (index: number, value: string) => {
    const updatedPoints = [...promptPoints];
    updatedPoints[index] = value;
    setPromptPoints(updatedPoints);
  };

  return (
    <div>
      <div
        className={`relative flex flex-col pl-2 mt-[30px] rounded-md p-4 mx-auto my-auto bg-white border border-transparent`}
      >
        <div>
          <h1 className="text-base font-normal mt-[10px] leading-6 text-gray-900 relative">
            Below write the conditions for the Criteria above
            <span className="absolute -top-1 left-38 text-blue-400">*</span>
          </h1>
          {promptOptions.map((choice, index) => (
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
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                <input
                  type="number"
                  className="p-2 border ml-[10px] rounded-md h-[3.256rem] w-[100px] text-gray-700 bg-transparent outline-none"
                  placeholder={`ex. ${index}`}
                  value={promptPoints[index]}
                  onChange={(event) =>
                    handlePromptPoints(index, event.target.value)
                  }
                  min={1}
                  max={100}
                  style={{
                    maxWidth: "100%",
                  }}
                />
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                <input
                  type="text"
                  className="p-2 rounded-md ml-[10px] w-[700px] h-[3.256rem] text-black bg-transparent outline-none"
                  placeholder={`ex. “The question is not legible” `}
                  value={choice}
                  onChange={(event) =>
                    handleChoiceChangeWrittenQuestion(index, event.target.value)
                  }
                  style={{
                    maxWidth: "100%",
                  }}
                />
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
              </div>

              <button
                className="ml-2 text-red-600"
                onClick={() => handleRemoveChoiceWrittenQuestion(index)}
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
            className="bg-gray-100 w-[70px] text-black p-2 rounded-md mt-2 flex items-center justify-center"
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
        </div>
      </div>

      {/* this is a add button for each criteria, we need to remove this and change the state function */}
      {/* this is a add button for each criteria, we need to remove this and change the state function */}
      {/* this is a add button for each criteria, we need to remove this and change the state function */}
      {/* this is a add button for each criteria, we need to remove this and change the state function */}
      {/* <button
        className="bg-gray-200 text-gray-500 p-2 rounded-md mt-2 flex items-center"
        onClick={handleAddDiv}
      >
        <span>Add Criteria</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="25"
          viewBox="0 0 24 25"
          fill="none"
          className="ml-2" // Add margin to separate the text and the SVG
        >
          <path
            d="M12 6.0166V18.0166M18 12.0166H6"
            stroke="#6B7280"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button> */}
      {/* this is a add button for each criteria, we need to remove this and change the state function */}
      {/* this is a add button for each criteria, we need to remove this and change the state function */}
      {/* this is a add button for each criteria, we need to remove this and change the state function */}
      {/* this is a add button for each criteria, we need to remove this and change the state function */}
    </div>
  );
}

export default ExtendableRubricChartProps;
