import { useState } from "react";

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
  // const [promptOptions, setPromptOptions] = useState<string[]>([]);
  // New state for promptPoints as a matrix
  // const [promptPoints, setPromptPoints] = useState<string[]>([]);

  type promptOption = {
    point: string;
    description: string;
  };
  // Initialize the promptOptions state with two default rubric options
  const initialPromptOptions: promptOption[] = [
    {
      point: "0",
      description: "",
    },
    {
      point: "1",
      description: "",
    },
  ];

  const [promptOptions, setPromptOptions] =
    useState<promptOption[]>(initialPromptOptions);

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
    // Create a copy of the current state
    const updatedOptions = [...promptOptions];

    // Update the description of the promptOption at the specified index
    updatedOptions[index] = { ...updatedOptions[index], description: value };

    // Update the state with the modified array
    setPromptOptions(updatedOptions);
  };

  const handleAddChoiceWrittenQuestion = () => {
    // Create a copy of the current state
    const updatedOptions = [...promptOptions];

    // Append a new empty promptOption at the end of updatedOptions
    updatedOptions.push({ point: "", description: "" });

    // Update the state with the modified array
    setPromptOptions(updatedOptions);
  };

  const handlePromptPoints = (index: number, value: string) => {
    // Create a copy of the current state
    const updatedOptions = [...promptOptions];

    // Update the point of the promptOption at the specified index
    updatedOptions[index] = { ...updatedOptions[index], point: value };

    // Update the state with the modified array
    setPromptOptions(updatedOptions);
  };

  // This function is used to auto adjust the height of the textarea when the user types multiple lines of text
  function textAreaAdjust(element) {
    var offset = element.offsetHeight - element.clientHeight;
    element.style.height = "auto";
    element.style.height = element.scrollHeight + offset + "px";
    window.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }

  return (
    <div>
      <div
        className={`relative flex flex-col pl-2 mt-[30px] rounded-md p-4 mx-auto my-auto bg-white border border-transparent`}
      >
        <div>
          <h1 className="text-base font-normal mt-[10px] leading-6 text-gray-900 relative">
            List the conditions for meeting the Criteria of Question
            <span className="absolute -top-1 left-38 text-blue-400">*</span>
          </h1>
          {promptOptions.map((choice, index) => (
            <div key={index} className="flex items-center mt-[10px]">
              {/* Add input for promptPoints */}
              <div className="flex items-center">
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                <input
                  type="number"
                  className="p-2 border ml-[10px] rounded-md h-[3.256rem] w-[100px] text-gray-700 bg-transparent outline-none"
                  placeholder={`ex. ${index}`}
                  value={promptOptions[index]?.point || ""}
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
                <textarea
                  onKeyUp={(event) => textAreaAdjust(event.target)}
                  className="p-2 rounded-md ml-[10px] text-black bg-transparent outline-none"
                  placeholder={`ex. “The question is not legible” `}
                  value={promptOptions[index]?.description || ""}
                  onChange={(event) =>
                    handleChoiceChangeWrittenQuestion(index, event.target.value)
                  }
                  style={{
                    width: "700px",
                    height: "3.256rem",
                    overflow: "hidden",
                    resize: "none",
                    paddingRight: "25%", // Add this line
                  }}
                />

                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
                {/* this is each rubric for the criteria, we need to change the state function from matrix to list*/}
              </div>

              <button
                className="ml-[-100px] text-red-600"
                onClick={() => handleRemoveChoiceWrittenQuestion(index)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="25"
                  viewBox="0 0 24 25"
                  fill="none"
                >
                  <path
                    d="M6 18.5L18 6.5M6 6.5L18 18.5"
                    stroke="#FCA5A5"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
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
