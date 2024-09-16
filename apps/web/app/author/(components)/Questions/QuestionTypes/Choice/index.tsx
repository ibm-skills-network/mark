import { Choice } from "@/config/types";
import { XMarkIcon } from "@heroicons/react/24/outline";
import {
  memo,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
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
  focusNextInput: (index: number) => void; // Function to focus the next input field
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
    focusNextInput,
  } = props;

  const { choice: choiceText, points, isCorrect } = choice;

  const [localChoiceText, setLocalChoiceText] = useState(choice?.choice || "");
  const [localPoints, setLocalPoints] = useState<number>(points || 0);

  useEffect(() => {
    setLocalChoiceText(choice?.choice || "");
    setLocalPoints(points || 0);
  }, [choice?.choice, points]);

  const handleBlur = () => {
    changeText(index, localChoiceText);
  };

  const handlePointsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10) || 0;
    if(isCorrect && value < 0 || value > 100) {
      return;
    }
    else if(!isCorrect && value > 0) {
      return;
    }
    setLocalPoints(value);
  };
  const handleChangeCorrect = (index: number, value: boolean) => {
    const negativePoints = localPoints * -1;
    console.log(negativePoints);
    changePoints(index, negativePoints);
    setLocalPoints(negativePoints); // convert number from positive to negative and vice versa
    toggleChoice(index);
  }

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
        className={`${
          isSingleChoice? "rounded-full" : "rounded"
        }`}
        checked={isCorrect}
        onChange={() => {
          handleChangeCorrect(index, !isCorrect);
        }}
      />
      <input
        className="w-full overflow-hidden !border-transparent transition hover:!border-b-gray-300 focus:!border-b-gray-600 !ring-0 p-2 text-black outline-none"
        placeholder={`Choice ${index + 1}`}
        id={index.toString()}
        value={localChoiceText}
        onChange={(event) => setLocalChoiceText(event.target.value)}
        onBlur={handleBlur}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            handleBlur();
            focusNextInput(index);
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
          onChange={handlePointsChange}
          onBlur={() => changePoints(index, localPoints)}
          style={{
            width: `${localPoints?.toString().length + 4}ch`,
          }}
        />
      </div>
      <button className="text-red-600 pl-1" onClick={() => removeChoice(index)}>
        <XMarkIcon className="w-5" />
      </button>
    </li>
  );
});

export default ChoiceComponent;
