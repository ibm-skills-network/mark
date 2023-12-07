import { XMarkIcon } from "@heroicons/react/24/outline";
import { type ChangeEvent, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"li"> {
  index: number;
  choice: string;
  isChecked: boolean;
  toggleChoice: (choiceIndex: number) => void;
  modifyChoice: (index: number, value: string) => void;
  removeChoice: (choiceIndex: number) => void;
  addChoice: () => void;
}

function Component(props: Props) {
  const {
    index,
    choice,
    isChecked,
    toggleChoice,
    modifyChoice,
    removeChoice,
    addChoice,
  } = props;

  function handleChoiceTextChange(event: ChangeEvent<HTMLInputElement>) {
    modifyChoice(index, event.target.value);
  }

  return (
    <li key={index} className="flex items-center gap-x-1.5">
      <input
        type="checkbox"
        className="rounded"
        id={index.toString()}
        checked={isChecked}
        onChange={() => toggleChoice(index)}
      />
      <input
        className="w-full overflow-hidden !border-transparent transition hover:!border-b-gray-300 focus:!border-b-gray-600 !ring-0 p-2 text-black outline-none"
        placeholder={`Choice ${index + 1}`}
        value={choice}
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
          if (event.key === "Backspace" && choice === "") {
            removeChoice(index);
          }
        }}
      />
      <button
        className=" text-red-600"
        onClick={() => {
          removeChoice(index);
        }}
      >
        <XMarkIcon className="w-6" />
      </button>
    </li>
  );
}

export default Component;
