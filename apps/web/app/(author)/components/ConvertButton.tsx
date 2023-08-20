import React, { useState } from 'react';

interface ConvertButtonProps {
  inputText: string;
  displayText: string;
  selectedQuestionType: QuestionType | null;
  optionsSingleCorrect: string[];
  selectedOptionSingleCorrect: string | null;
  optionsMultipleAnswers: string[];
  selectedOptionsMultipleAnswers: string[];
  writtenQuestionText: string;
}

const ConvertButton: React.FC<ConvertButtonProps> = ({
  inputText,
  displayText,
  selectedQuestionType,
  optionsSingleCorrect,
  selectedOptionSingleCorrect,
  optionsMultipleAnswers,
  selectedOptionsMultipleAnswers,
  writtenQuestionText,
}) => {
  const [jsonString, setJsonString] = useState<string | null>(null);

  const generateJsonData = () => {
    const data = {
      inputText,
      displayText,
      questionType: selectedQuestionType,
      optionsSingleCorrect,
      selectedOptionSingleCorrect,
      optionsMultipleAnswers,
      selectedOptionsMultipleAnswers,
      writtenQuestionText,
    };

    setJsonString(JSON.stringify(data, null, 2));
  };

  return (
    <div>
      <button className="bg-blue-500 text-white px-4 py-2 rounded" onClick={generateJsonData}>
        Convert All Text Boxes into JSON
      </button>
      {jsonString && (
        <div className="mt-4">
          <p>Generated JSON Data:</p>
          <pre className="bg-gray-100 p-2 rounded-md text-black overflow-auto">
            {jsonString}
          </pre>
        </div>
      )}
    </div>
  );
};

export default ConvertButton;
