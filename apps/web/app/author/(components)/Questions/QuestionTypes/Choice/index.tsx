import { Choice } from "@/config/types";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { memo, useRef, useState, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"li"> {
  questionId: number; // Include questionId to uniquely identify the question
  index: number;
  choice: Choice;
  isSingleChoice: boolean; // Prop to indicate if it's single choice or multi-select
  toggleChoice: (index: number) => void;
  removeChoice: (index: number) => void;
  addChoice: () => void;
  changeText: (index: number, value: string) => void;
  changePoints: (index: number, value: number) => void;
  preview: boolean;
  choices: Choice[];
}

const ChoiceComponent = memo(function Component(props: Props) {
  const {
    questionId, // Use questionId to ensure uniqueness
    index,
    choice,
    isSingleChoice,
    toggleChoice,
    removeChoice,
    addChoice,
    changeText,
    changePoints,
    preview,
    choices,
  } = props;
  const { choice: choiceText, points, isCorrect } = choice;
  const [localChoiceText, setLocalChoiceText] = useState(choice?.choice || "");
  const [localPoints, setLocalPoints] = useState<number>(points || 0);
  const [backspaceCount, setBackspaceCount] = useState(0);
  const backspaceTimerRef = useRef<NodeJS.Timeout | null>(null); // To track the debounce timer

  const handleBlur = () => {
    changeText(index, localChoiceText);
  };

  const handlePointsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10) || 0;
    if ((isCorrect && value < 0) || value > 100) {
      return;
    } else if (!isCorrect && value > 0) {
      return;
    }
    setLocalPoints(value);
  };
  const handleChangeCorrect = (index: number, value: boolean) => {
    const negativePoints = localPoints * -1;
    changePoints(index, negativePoints);
    setLocalPoints(negativePoints);
    toggleChoice(index);
  };
  // Function to handle backspace press to remove choice
  const handleBackspacePress = (index: number, event: React.KeyboardEvent) => {
    const value = (event.currentTarget as HTMLInputElement).value;

    if (event.key === "Backspace" && value === "") {
      if (backspaceTimerRef.current) {
        clearTimeout(backspaceTimerRef.current);
      }

      setBackspaceCount((prevCount) => prevCount + 1);

      backspaceTimerRef.current = setTimeout(() => {
        setBackspaceCount(0);
      }, 10000);

      if (backspaceCount === 1) {
        removeChoice(index);

        setTimeout(() => {
          const lastChoiceInput = document.getElementById(
            `Choice-${questionId}-${index - 1}`,
          );
          if (lastChoiceInput) {
            lastChoiceInput.focus();
          }
        }, 100);

        setBackspaceCount(0);
      }
    } else {
      setBackspaceCount(0);
    }
  };
  // Function to focus the next input field or create a new choice
  const focusNextInput = (index: number) => {
    if (index < choices.length - 1) {
      setTimeout(() => {
        const newInput = document.getElementById(
          `Choice-${questionId}-${index + 1}`,
        );
        if (newInput) {
          newInput.focus();
        }
      }, 100);
    } else {
      addChoice();
      setTimeout(() => {
        const newInput = document.getElementById(
          `Choice-${questionId}-${choices.length}`,
        );
        if (newInput) {
          newInput.focus();
        }
      }, 100);
    }
  };
  return (
    <li key={index} className="flex items-center gap-x-1.5">
      {/* Conditionally render checkbox or radio button based on isSingleChoice */}
      <input
        type={isSingleChoice ? "radio" : "checkbox"}
        name={
          isSingleChoice
            ? `single-choice-${questionId}-${index}`
            : `multi-choice-${questionId}-${index}`
        } // Ensure the name is unique per question
        className={`${isSingleChoice ? "rounded-full" : "rounded"}`}
        checked={isCorrect}
        disabled={preview}
        onChange={() => {
          handleChangeCorrect(index, !isCorrect);
        }}
      />
      <input
        className="w-full overflow-hidden !border-transparent transition hover:!border-b-gray-300 focus:!border-b-gray-600 !ring-0 p-2 text-black outline-none"
        placeholder={`Choice ${index + 1}`}
        id={`Choice-${questionId}-${index}`}
        value={localChoiceText}
        onChange={(event) => setLocalChoiceText(event.target.value)}
        onBlur={handleBlur}
        disabled={preview}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            handleBlur();
            focusNextInput(index);
          } else {
            handleBackspacePress(index, event);
          }
        }}
      />
      <div className="relative">
        <input
          type="number"
          className={`text-left w-14 focus:outline-none focus:ring-0 px-2 py-0 text-gray-600 ${
            isCorrect ? "border rounded" : "border-none"
          }`}
          value={localPoints}
          disabled={preview}
          onChange={handlePointsChange}
          onBlur={() => changePoints(index, localPoints)}
          style={{
            width: `${localPoints?.toString().length + 4}ch`,
          }}
        />
      </div>
      <button
        className="text-red-600 pl-1"
        disabled={preview}
        onClick={() => removeChoice(index)}
      >
        <XMarkIcon className="w-5" />
      </button>
    </li>
  );
});

export default ChoiceComponent;
