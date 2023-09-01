"use client";

import MultipleChoiceQuestion from "@/app/learner/(components)/MultipleChoiceQuestion";
import TextQuestion from "@/app/learner/(components)/TextQuestion";
import Dropdown from "@authorComponents/Dropdown";
import MarkdownEditor from "@components/MarkDownEditor";
import { Listbox, RadioGroup, Transition } from "@headlessui/react";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/solid";
import React, { Fragment, useEffect, useRef, useState } from "react";
import MultipleAnswerSection from "./MultipleAnswerSection";
import RubricTable from "./RubricTable";
import SingleAnswerSection from "./SingleAnswerSection";
import WrittenQuestionView from "./WrittenQuestionView";

//////////////////Answer Type////////////////////////////////////////
const answerTypes = [
  {
    title: "Single Answer",
    description: "This multiple choice should have exactly one answer.",
    current: false,
  },
  {
    title: "Multiple Answer",
    description: "This multiple choice can have zero or more than one answer",
    current: false,
  },
  {
    title: "Text",
    description: "This question has a written answer",
    current: false,
  },
];
function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

const initialRubrics = [
  {
    criteria: "",
    judgement: "",
    rate: "",
    weight: "",
  },
  // More rubrics ...
];

//////////////////////////Single Multiple Choice Type////////////////////////////////////////////
const singleAnswer = [
  {
    name: "Public access",
    description: "This project would be available to anyone who has the link",
  },
  {
    name: "Private to Project Members",
    description: "Only members of this project would be able to access",
  },
  {
    name: "Private to you",
    description: "You are the only one able to access this project",
  },
];

enum QuestionType {
  SingleCorrect = "single_correct",
  MultipleAnswers = "multiple_answers",
  WrittenQuestion = "written_question",
}

function TextBox() {
  const [isLearnerView, setIsLearnerView] = useState(false);
  const [inputText, setInputText] = useState("");
  const [displayText, setDisplayText] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedQuestionType, setSelectedQuestionType] =
    useState<QuestionType | null>(null);
  const [optionsSingleCorrect, setOptionsSingleCorrect] = useState<string[]>(
    []
  );
  const [selectedOptionSingleCorrect, setSelectedOptionSingleCorrect] =
    useState<string | null>(null);
  const [optionsMultipleAnswers, setOptionsMultipleAnswers] = useState<
    string[]
  >([]);
  const [selectedOptionsMultipleAnswers, setSelectedOptionsMultipleAnswers] =
    useState<string[]>([]);
  const [writtenQuestionText, setWrittenQuestionText] = useState("");
  const [questions, setQuestions] = useState<Array<JSX.Element>>([]);
  const [jsonData, setJsonData] = useState<{
    inputText: string;
    displayText: string;
    questionType: QuestionType | null;
    optionsSingleCorrect: string[];
    selectedOptionSingleCorrect: string | null;
    optionsMultipleAnswers: string[];
    selectedOptionsMultipleAnswers: string[];
    writtenQuestionText: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isTableMode, setIsTableMode] = useState(false);
  const [optionsWrittenQuestion, setOptionsWrittenQuestion] = useState<
    string[]
  >([]);
  const [isActive, setIsActive] = useState(false); // Track the active state of the component
  const [score, setScore] = useState("");
  const [switchState, setSwitchState] = useState("a");
  const [answerTypeSelected, setAnswerTypeSelected] = useState(answerTypes[0]); // use this the change the state of the answer type (single multiple written)

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

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

    setJsonData(data);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(event.target.value);
  };

  const handleDisplayText = () => {
    setDisplayText(inputText);
  };

  const handleMenuToggle = () => {
    setIsMenuOpen((prevIsMenuOpen) => !prevIsMenuOpen);
  };

  const handleQuestionTypeSelect = (questionType: QuestionType) => {
    setSelectedQuestionType(questionType);
    setIsMenuOpen(false);
    setOptionsSingleCorrect([]);
    setSelectedOptionSingleCorrect(null);
    setWrittenQuestionText("");
  };

  const handleOptionChangeSingleCorrect = (index: number, value: string) => {
    const updatedOptions = [...optionsSingleCorrect];
    updatedOptions[index] = value;
    setOptionsSingleCorrect(updatedOptions);
  };

  const handleOptionToggleSingleCorrect = (index: number) => {
    setSelectedOptionSingleCorrect((prevSelectedOption) => {
      return prevSelectedOption === optionsSingleCorrect[index]
        ? null
        : optionsSingleCorrect[index];
    });
  };

  const handleOptionToggleMultipleAnswers = (option: string) => {
    setSelectedOptionsMultipleAnswers((prevSelectedOptions) => {
      if (prevSelectedOptions.includes(option)) {
        return prevSelectedOptions.filter(
          (selectedOption) => selectedOption !== option
        );
      } else {
        return [...prevSelectedOptions, option];
      }
    });
  };

  const handleOptionChangeMultipleAnswers = (index: number, value: string) => {
    const updatedOptions = [...optionsMultipleAnswers];
    updatedOptions[index] = value;
    setOptionsMultipleAnswers(updatedOptions);
  };

  const handleWrittenQuestionChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setWrittenQuestionText(event.target.value);
  };

  const handleOptionChangeWrittenQuestion = (index: number, value: string) => {
    const updatedOptions = [...optionsWrittenQuestion];
    updatedOptions[index] = value;
    setOptionsWrittenQuestion(updatedOptions);
  };

  const handleAddOptionWrittenQuestion = () => {
    setOptionsWrittenQuestion([...optionsWrittenQuestion, ""]);
  };

  const handleRemoveOptionWrittenQuestion = (index: number) => {
    const updatedOptions = optionsWrittenQuestion.filter((_, i) => i !== index);
    setOptionsWrittenQuestion(updatedOptions);
  };

  const handleScore = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newScore = event.target.value;
    setScore(newScore);
  };

  return (
    <div
      className={`relative flex flex-col pl-2 rounded-md p-4 mx-auto my-auto`}
      style={{
        width: "67rem",
        minHeight: "30.5rem",
        maxWidth: "100%",
      }}
    >
      {/* Toggle view button */}
      <button
        className="w-52 rounded-md bg-indigo-50 px-3.5 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm hover:bg-indigo-100 ml-[380px]"
        onClick={() => setIsLearnerView(!isLearnerView)}
      >
        {isLearnerView ? "Author View" : "Learner View"}
      </button>

      {isLearnerView ? (
        <div>
          {selectedQuestionType === QuestionType.SingleCorrect ||
          selectedQuestionType === QuestionType.MultipleAnswers ? (
            <MultipleChoiceQuestion
            // questionData={{}}
            />
          ) : selectedQuestionType === QuestionType.WrittenQuestion ? (
            <TextQuestion
              // questionData={{}}
              questionNumber={questions.length + 1}
            />
          ) : null}
        </div>
      ) : (
        <div
          className="flex flex-col mt-8 bg-white transition border-l-8 rounded-md p-10 border-blue-700"
          style={{
            minWidth: "62.5625rem",
            minHeight: "25.5rem",
          }}
        >
          Question:
          {/* <button
        className="bg-blue-500 text-white p-2 rounded-md ml-2"
        onClick={generateJsonData}
      >
        Convert to JSON
      </button> */}
          {jsonData && (
            <div className="mt-4">
              <p>Generated JSON Data:</p>
              <pre className="bg-gray-100 p-2 rounded-md text-black overflow-auto">
                {JSON.stringify(jsonData, null, 2)}
              </pre>
            </div>
          )}
          <MarkdownEditor
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
            value={inputText}
            setValue={setInputText}
          />
          {/* <div className="mt-2">
        <button
          className="bg-blue-500 text-white p-2 rounded-md"
          onClick={handleDisplayText}
        >
          Display Text
        </button>
      </div>
      {displayText && (
        <div className="mt-4">
          <p>Displayed Text:</p>
          <p className="bg-gray-100 p-2 rounded-md text-black">{displayText}</p>
        </div>
      )} */}
          <div className="text-m text-black font-inter text-1rem leading-1.25rem mr-2 h-4 mt-[20px]">
            Question Type
          </div>
          <div className="my-[20px]">
            <Dropdown
              answerTypeSelected={answerTypeSelected}
              setAnswerTypeSelected={setAnswerTypeSelected}
              answerTypes={answerTypes}
            />
          </div>
          {answerTypeSelected === answerTypes[0] ? (
            <SingleAnswerSection
              optionsSingleCorrect={optionsSingleCorrect}
              selectedOptionSingleCorrect={selectedOptionSingleCorrect}
              handleOptionToggleSingleCorrect={handleOptionToggleSingleCorrect}
              handleOptionChangeSingleCorrect={handleOptionChangeSingleCorrect}
              setOptionsSingleCorrect={setOptionsSingleCorrect}
            />
          ) : null}
          {answerTypeSelected === answerTypes[1] ? (
            <MultipleAnswerSection
              optionsMultipleAnswers={optionsMultipleAnswers}
              selectedOptionsMultipleAnswers={selectedOptionsMultipleAnswers}
              setOptionsMultipleAnswers={setOptionsMultipleAnswers}
              handleOptionToggleMultipleAnswers={
                handleOptionToggleMultipleAnswers
              }
              handleInputChange={handleInputChange}
              handleOptionChangeMultipleAnswers={
                handleOptionChangeMultipleAnswers
              }
              setSelectedOptionsMultipleAnswers={
                setSelectedOptionsMultipleAnswers
              }
            />
          ) : null}
          {answerTypeSelected === answerTypes[2] && (
            <WrittenQuestionView
              handleScore={handleScore}
              score={score}
              switchState={switchState}
              setSwitchState={setSwitchState}
              optionsWrittenQuestion={optionsWrittenQuestion}
              handleOptionChangeWrittenQuestion={
                handleOptionChangeWrittenQuestion
              }
              handleRemoveOptionWrittenQuestion={
                handleRemoveOptionWrittenQuestion
              }
              handleAddOptionWrittenQuestion={handleAddOptionWrittenQuestion}
              initialRubrics={initialRubrics}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default TextBox;
