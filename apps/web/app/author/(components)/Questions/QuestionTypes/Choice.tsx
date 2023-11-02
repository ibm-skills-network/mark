import { XMarkIcon } from "@heroicons/react/24/outline";
import { type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"li"> {
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

  function handleChoiceTextChange(event: React.ChangeEvent<HTMLInputElement>) {
    modifyChoice(index, event.target.value);
  }

  return (
    <li key={index} className="flex items-center gap-x-1.5">
      <input
        type="checkbox"
        className="rounded"
        id={index.toString()}
        checked={isChecked}
        onChange={() => toggleChoice(choice)}
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
          removeChoice(choice);
        }}
      >
        <XMarkIcon className="w-6" />
      </button>
    </li>
  );
}

export default Component;
