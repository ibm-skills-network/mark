import { Choice } from "@/config/types";
import { XMarkIcon } from "@heroicons/react/24/outline";
import {
  useMemo,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
} from "react";
import { twMerge } from "tailwind-merge";
import NumberInputTooltip from "./NumberInputTooltip";

interface Props extends ComponentPropsWithoutRef<"li"> {
  index: number;
  choice: Choice;
  toggleChoice: (index: number) => void;
  removeChoice: (index: number) => void;
  addChoice: () => void;
  changeText: (index: number, value: string) => void;
  changePoints: (index: number, value: number) => void;
}

function Component(props: Props) {
  const {
    index,
    choice,
    toggleChoice,
    removeChoice,
    addChoice,
    changeText,
    changePoints,
  } = props;

  const { choice: choiceText, points, isCorrect } = choice;

  const pointsShowing = useMemo(() => {
    return isCorrect ? points : 0;
  }, [isCorrect, points]);

  function handleChoiceTextChange(event: ChangeEvent<HTMLInputElement>) {
    changeText(index, event.target.value);
  }

  function incrementPoints() {
    changePoints(index, points + 1);
  }

  function decrementPoints() {
    changePoints(index, points - 1);
  }

  return (
    <li key={index} className="flex items-center gap-x-1.5">
      <input
        type="checkbox"
        className="rounded"
        id={index.toString()}
        checked={isCorrect}
        onChange={() => toggleChoice(index)}
      />
      <input
        className="w-full overflow-hidden !border-transparent transition hover:!border-b-gray-300 focus:!border-b-gray-600 !ring-0 p-2 text-black outline-none"
        placeholder={`Choice ${index + 1}`}
        value={choiceText}
        onChange={handleChoiceTextChange}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            addChoice();
            // Hacky vanilla javascript to get the reference of the next input (first get the reference to the parent element, then get the next sibling,
            // then get the first child, then get the next sibling)
            // wait 100ms for the next input to be rendered, then focus on it
            setTimeout(() => {
              const inputElement = event.target as HTMLInputElement;
              const nextInput = inputElement.parentElement?.nextSibling
                ?.firstChild?.nextSibling as HTMLInputElement;
              if (nextInput) {
                nextInput.focus();
              }
            }, 100);
          }
          // if user clicks backspace and the input field is empty, delete the choice
          if (event.key === "Backspace" && choiceText === "") {
            removeChoice(index);
          }
        }}
      />
      <NumberInputTooltip
        disabled={!isCorrect}
        disableIncrement={points >= 9}
        disableDecrement={points <= 1}
        incrementPoints={incrementPoints}
        decrementPoints={decrementPoints}
        className={twMerge(
          "text-sm leading-5 transition-colors font-medium",
          isCorrect ? "text-blue-700" : "text-gray-500"
        )}
      >
        <div className=" whitespace-nowrap">
          {pointsShowing}{" "}
          {pointsShowing === 1 ? (
            <span className="pr-1.5">point</span>
          ) : (
            "points"
          )}
        </div>
      </NumberInputTooltip>
      <button
        className=" text-red-600 pl-1"
        onClick={() => {
          removeChoice(index);
        }}
      >
        <XMarkIcon className="w-5" />
      </button>
    </li>
  );
}

export default Component;
