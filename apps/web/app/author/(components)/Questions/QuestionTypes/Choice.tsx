import { XMarkIcon } from "@heroicons/react/24/outline";
import { type ComponentPropsWithoutRef, type ChangeEvent } from "react";

interface Props extends ComponentPropsWithoutRef<"li"> {
  index: number;
  choice: string;
  isChecked: boolean;
  toggleChoice: (choiceIndex: number) => void;
  modifyChoice: (index: number, value: string) => void;
  removeChoice: (choiceIndex: number) => void;
}

function Component(props: Props) {
  const { index, choice, isChecked, toggleChoice, modifyChoice, removeChoice } =
    props;

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
