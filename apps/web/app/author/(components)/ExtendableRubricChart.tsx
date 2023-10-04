import { useAuthorStore } from "@/stores/author";
import { useState } from "react";

interface ExtendableRubricChartProps {
  questionId: number;
  onMaxPointsChange: (maxPoints: number) => void; // Define the onMaxPointsChange prop
}

function ExtendableRubricChartProps(props: ExtendableRubricChartProps) {
  const { questionId } = props;
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

  const [questions, modifyQuestion, addCriteria, removeCriteria] =
    useAuthorStore((state) => [
      state.questions,
      state.modifyQuestion,
      state.addCriteria,
      state.removeCriteria,
    ]);
  const { scoring } = questions.find((question) => question.id === questionId);
  // TODO: I know that this is gonna create bugs in the future (when users refresh)
  const criteria = scoring?.criteria || [];
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

  const maxPoints = promptOptions.reduce((max, option) => {
    const optionPoints = ~~option.point;
    return optionPoints > max ? optionPoints : max;
  }, 0);

  // Call the onMaxPointsChange function with the maxPoints value
  props.onMaxPointsChange(maxPoints);

  // This function is used to auto adjust the height of the textarea when the user types multiple lines of text
  function textAreaAdjust(element: HTMLElement) {
    const offset = element.offsetHeight - element.clientHeight;
    const oldScrollTop = document.documentElement.scrollTop; // Save old scroll position

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + offset}px`;

    document.documentElement.scrollTop = oldScrollTop; // Reset scroll position
  }

  const numberInputOnWheelPreventChange = (e) => {
    // Prevent the input value change
    const eventInput = e as Event;
    const target = eventInput.currentTarget as HTMLInputElement;
    target.blur();

    // Prevent the page/container scrolling
    eventInput.stopPropagation();

    // Refocus immediately, on the next tick (after the current function is done)
    const targetInput = eventInput.target as HTMLInputElement;
    setTimeout(() => {
      targetInput.focus();
    }, 0);
  };
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
                <input
                  type="number"
                  className="p-2 border ml-[10px] rounded-md h-[3.256rem] w-[100px] text-gray-700 bg-transparent outline-none"
                  placeholder={`ex. ${index}`}
                  value={promptOptions[index]?.point || ""}
                  onChange={(event) => {
                    if (~~event.target.value > ~~event.target.max) {
                      event.target.value = event.target.max;
                    }
                    handlePromptPoints(index, event.target.value);
                  }}
                  min={1}
                  max={100}
                  style={{
                    maxWidth: "100%",
                    border: "1px solid #D1D5DB", // Add this line to set the border color to gray-300
                  }}
                  onWheel={numberInputOnWheelPreventChange}
                />

                <textarea
                  onKeyUp={(event) =>
                    textAreaAdjust(event.target as HTMLElement)
                  }
                  className="p-2 rounded-md ml-[10px] text-black bg-transparent outline-none"
                  placeholder={
                    index === 0
                      ? `ex. “The question is not legible” `
                      : `ex. “The question is legible” `
                  }
                  value={promptOptions[index]?.description || ""}
                  onChange={(event) =>
                    handleChoiceChangeWrittenQuestion(index, event.target.value)
                  }
                  style={{
                    width: "800px",
                    height: "3.256rem",
                    overflow: "hidden",
                    resize: "none",
                    paddingRight: "8%", // Add this line
                    border: "1px solid #D1D5DB", // Add this line to set the border color to gray-300
                  }}
                />
              </div>

              <button
                className="ml-[-60px] text-red-600"
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
    </div>
  );
}

export default ExtendableRubricChartProps;
