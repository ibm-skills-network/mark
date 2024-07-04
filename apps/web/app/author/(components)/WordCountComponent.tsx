import { ChangeEvent, useState, type FC } from "react";

interface WordCountComponentProps {
  maxWords: number | null;
  handleMaxWordCountChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

const WordCountComponent: FC<WordCountComponentProps> = (props) => {
  const { handleMaxWordCountChange, maxWords } = props;

  return (
    <div className="flex flex-col gap-y-1">
      <label className="leading-5 text-gray-800 flex gap-x-0.5">
        Maximum word count
        <span className="text-gray-500">(Optional)</span>
      </label>

      <input
        type="number"
        className="rounded-md transition py-3 px-4 border-gray-300 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500"
        placeholder="ex. 250"
        value={maxWords}
        onChange={handleMaxWordCountChange}
        min={1}
        max={10000}
        step={10}
      />
    </div>
  );
};

export default WordCountComponent;
