import React, { useState } from "react";

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

  return (
    <div>
      <p>
        {mainText}
        <span className="text-gray-600">(Optional){optionalText}</span>
      </p>
      <div>
        <input
          type="number"
          className="rounded-md w-[9.17381rem] h-[3.53331rem] text-1.5xl"
          placeholder={`ex. 600`}
          value={textArea1Value}
          onChange={handleTextArea1Change}
          min={20}
          max={5000}
          step={20}
        />
        <input
          type="number"
          className="rounded-md ml-[30px] mt-[10px] mb-[30px] w-[9.17381rem] h-[3.53331rem]"
          placeholder={`ex. 1200`}
          value={textArea2Value}
          onChange={handleTextArea2Change}
          min={20}
          max={5000}
          step={20}
        />
      </div>
    </div>
  );
};

export default WordCountComponent;
