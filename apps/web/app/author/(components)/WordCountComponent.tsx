import { useState } from "react";

interface WordCountComponentProps {
  text: string;
}

const WordCountComponent: React.FC<WordCountComponentProps> = ({ text }) => {
  const [textArea1Value, setTextArea1Value] = useState("");
  const [textArea2Value, setTextArea2Value] = useState("");

  // Split the text into two parts
  const [mainText, optionalText] = text.split("(Optional)");

  // Add validation check to prevent textArea1Value > textArea2Value
  const handleTextArea1Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (parseFloat(value) > parseFloat(textArea2Value)) {
      setTextArea1Value(textArea2Value);
    } else {
      setTextArea1Value(value);
    }
  };

  const handleTextArea2Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (parseFloat(value) < parseFloat(textArea1Value)) {
      setTextArea2Value(textArea1Value);
    } else {
      setTextArea2Value(value);
    }
  };
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
    <div className="flex flex-col gap-y-1">
      <label className="font-medium leading-5 text-gray-800">
        {mainText}
        <span className="text-gray-500">(Optional){optionalText}</span>
      </label>

      <input
        type="number"
        className="rounded-md h-12 p-4 w-full border-gray-300 shadow-sm placeholder-gray-400 focus:ring-indigo-500 focus:border-indigo-500"
        onWheel={numberInputOnWheelPreventChange}
        placeholder={`ex. 250`}
        value={textArea2Value}
        // TODO: send to backend
        onChange={handleTextArea2Change}
        min={1}
        max={5000}
        step={10}
      />
    </div>
  );
};

export default WordCountComponent;
