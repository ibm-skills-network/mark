import { useAuthorStore } from "@/stores/author";
import { useState, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  index: number;
  choice: string;
  isChecked: boolean;
  toggleChoice: (selected: string) => void;
  modifyChoice: (index: number, value: string) => void;
  removeChoice: (choice: string) => void;
}

function Component(props: Props) {
  const { index, choice, isChecked, toggleChoice, modifyChoice, removeChoice } =
    props;

  const [isInputMode, setIsInputMode] = useState(false);

  function handleChoiceTextChange(
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) {
    modifyChoice(index, event.target.value);
  }

  return (
    <div key={index} className="flex items-center mb-[5px]">
      <input
        type="checkbox"
        id={index.toString()}
        checked={isChecked}
        onChange={() => toggleChoice(choice)}
      />
      <div className="ml-2">
        {" "}
        {/* Add margin to create space */}
        {String.fromCharCode(65 + index)}.
      </div>
      <textarea
        className="w-[800px] p-2 border-transparent mb-[10px] rounded-md text-black bg-transparent outline-none" // Removed 'border ml-2' and added 'w-full'
        placeholder={`Choice ${index + 1}`}
        value={choice}
        onChange={handleChoiceTextChange}
        style={{
          height: "2.0rem", // Changed 'height' to 'minHeight'
          maxWidth: "100%",
          overflow: "hidden",
          resize: "vertical",
        }}
      />
      <button
        className="ml-2 text-red-600"
        onClick={() => {
          removeChoice(choice);
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          className="w-6 h-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z"
          />
        </svg>
      </button>
      {/* TODO: Add points support */}
      <div className="ml-[5px]">
        {isInputMode ? (
          <input
            className="w-[80px]"
            type="number"
            autoFocus
            onBlur={() => setIsInputMode(false)}
          />
        ) : (
          <button
            // onClick={() => handleButtonClick(choiceId)}
            style={{
              color: isChecked ? "blue-700" : "gray-700",
              borderColor: "transparent",
              backgroundColor: "transparent",
              cursor: isChecked ? "pointer" : "not-allowed", // Set cursor based on checkbox state
            }}
            disabled={!isChecked} // Disable button when checkbox is not checked
          >
            {0} points
          </button>
        )}
      </div>
    </div>
  );
}

export default Component;
