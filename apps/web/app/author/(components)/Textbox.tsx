"use client";

import type { Choice, Question, QuestionTypeDropdown } from "@/config/types";
import { useAuthorStore } from "@/stores/author";
import Dropdown from "@authorComponents/Dropdown";
import MarkdownEditor from "@components/MarkDownEditor";
import { useEffect, useRef, useState } from "react";
import WrittenQuestionView from "./WrittenQuestionView";

//////////////////Answer Type////////////////////////////////////////
const questionTypes = [
  // {
  //   label: "Single Answer",
  //   description: "This multiple choice should have exactly one answer.",
  //   value: "SINGLE_CORRECT"
  // },
  // {
  //   label: "Multiple Answer",
  //   description: "This multiple choice can have zero or more than one answer",
  //   value: "MULTIPLE_CORRECT"
  // },
  {
    label: "Text",
    description: "This question has a written answer",
    value: "TEXT",
  },
] as QuestionTypeDropdown[];
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

interface Props extends React.ComponentPropsWithoutRef<"div"> {
  question: Question;
}

function TextBox(props: Props) {
  const { question } = props;
  const [isLearnerView, setIsLearnerView] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedChoiceSingleCorrect, setSelectedChoiceSingleCorrect] =
    useState<string | null>(null);
  const [choicesMultipleAnswers, setChoicesMultipleAnswers] = useState<
    Choice[]
  >([]);
  const [selectedChoicesMultipleAnswers, setSelectedChoicesMultipleAnswers] =
    useState<string[]>([]);
  const [writtenQuestionText, setWrittenQuestionText] = useState("");
  const [
    setQuestions,
    removeQuestion,
    addQuestion,
    activeAssignmentId,
    modifyQuestion,
  ] = useAuthorStore((state) => [
    state.setQuestions,
    state.removeQuestion,
    state.addQuestion,
    state.activeAssignmentId,
    state.modifyQuestion,
  ]);
  const menuRef = useRef<HTMLDivElement>(null);
  const [choicesWrittenQuestion, setChoicesWrittenQuestion] = useState<
    string[]
  >([]);
  const [score, setScore] = useState("");
  const [switchState, setSwitchState] = useState("a");
  const [questionType, setQuestionType] = useState<QuestionTypeDropdown>(
    questionTypes[0]
  ); // use this the change the state of the answer type (single multiple written)

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

  const handleQuestionTextChange = (value: string) => {
    modifyQuestion(question.id, {
      question: value,
    });
  };

  // const handleDisplayText = () => {
  //   setDisplayText(inputText);
  // };

  // const handleMenuToggle = () => {
  //   setIsMenuOpen((prevIsMenuOpen) => !prevIsMenuOpen);
  // };

  // const handleQuestionTypeSelect = (questionType: QuestionType) => {
  //   setSelectedQuestionType(questionType);
  //   setIsMenuOpen(false);
  //   setChoicesSingleCorrect([]);
  //   setSelectedChoiceSingleCorrect(null);
  //   setWrittenQuestionText("");
  // };

  // const handleChoiceChangeSingleCorrect = (index: number, value: string) => {
  //   const updatedChoices = [...choicesSingleCorrect];
  //   updatedChoices[index] = value;
  //   setChoicesSingleCorrect(updatedChoices);
  // };

  // const handleChoiceToggleSingleCorrect = (index: number) => {
  //   setSelectedChoiceSingleCorrect((prevSelectedChoice) => {
  //     return prevSelectedChoice === choicesSingleCorrect[index]
  //       ? null
  //       : choicesSingleCorrect[index];
  //   });
  // };

  // const handleChoiceToggleMultipleAnswers = (choice: string) => {
  //   setSelectedChoicesMultipleAnswers((prevSelectedChoices) => {
  //     if (prevSelectedChoices.includes(choice)) {
  //       return prevSelectedChoices.filter(
  //         (selectedChoice) => selectedChoice !== choice
  //       );
  //     } else {
  //       return [...prevSelectedChoices, choice];
  //     }
  //   });
  // };

  // const handleChoiceChangeMultipleAnswers = (index: number, value: string) => {
  //   const updatedChoices = [...choicesMultipleAnswers];
  //   updatedChoices[index] = value;
  //   setChoicesMultipleAnswers(updatedChoices);
  // };

  // const handleWrittenQuestionChange = (
  //   event: React.ChangeEvent<HTMLInputElement>
  // ) => {
  //   setWrittenQuestionText(event.target.value);
  // };

  const handleChoiceChangeWrittenQuestion = (index: number, value: string) => {
    const updatedChoices = [...choicesWrittenQuestion];
    updatedChoices[index] = value;
    setChoicesWrittenQuestion(updatedChoices);
  };

  const handleAddChoiceWrittenQuestion = () => {
    setChoicesWrittenQuestion([...choicesWrittenQuestion, ""]);
  };

  const handleRemoveChoiceWrittenQuestion = (index: number) => {
    const updatedChoices = choicesWrittenQuestion.filter((_, i) => i !== index);
    setChoicesWrittenQuestion(updatedChoices);
  };

  const handleScore = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newScore = event.target.value;
    setScore(newScore);
  };

  return (
    <div className={`relative flex flex-col flex-1 max-w-6xl rounded-md`}>
      {/* Toggle view button */}
      {/* <button
        className="w-52 rounded-md bg-indigo-50 px-3.5 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm hover:bg-indigo-100 ml-[380px]"
        onClick={() => setIsLearnerView(!isLearnerView)}
      >
        {isLearnerView ? "Author View" : "Learner View"}
      </button>

      {isLearnerView ? (
        <div>
          {question.type === "MULTIPLE_CORRECT" ? (
            <MultipleChoiceQuestion
              questionData={{
                question: question.question,
                choices: question.choices,
                answer: question.answer,
                totalPoints: question.totalPoints,
              }}
            />
          ) : question.type === "TEXT" ? (
            <TextQuestion
              questionData={question}
            />
          ) : null}
        </div>
      ) : ( */}
      <div className="flex flex-col bg-white transition border-l-8 rounded-md p-10 border-blue-700">
        Question
        <MarkdownEditor
          value={"" as string}
          setValue={handleQuestionTextChange}
          textareaClassName="!min-h-[6.5rem] !max-h-72"
          className="bg-gray-600"
        />
        <div className="text-black font-inter leading-5 mr-2 h-4 mt-5">
          Question Type
        </div>
        <div className="my-5">
          <Dropdown
            questionType={questionType}
            setQuestionType={setQuestionType}
            questionTypes={questionTypes}
          />
        </div>
        {/* {questionType === questionTypes[0] ? (
          <SingleAnswerSection
            choices={question.choices}
            selectedChoiceSingleCorrect={selectedChoiceSingleCorrect}
            handleChoiceToggleSingleCorrect={handleChoiceToggleSingleCorrect}
            handleChoiceChangeSingleCorrect={handleChoiceChangeSingleCorrect}
            setChoicesSingleCorrect={setChoicesSingleCorrect}
          />
        ) : null}
        {questionType === questionTypes[1] ? (
          <MultipleAnswerSection
            choices={question.choices}
            selectedChoices={selectedChoicesMultipleAnswers}
            setChoices={setChoicesMultipleAnswers}
            handleChoiceToggle={handleChoiceToggleMultipleAnswers}
            handleChoiceChange={handleChoiceChangeMultipleAnswers}
            setSelectedChoices={setSelectedChoicesMultipleAnswers}
          />
        ) : null} */}
        {questionType.value === "TEXT" ? (
          <WrittenQuestionView
            handleScore={handleScore}
            score={score}
            switchState={switchState}
            setSwitchState={setSwitchState}
            choicesWrittenQuestion={choicesWrittenQuestion}
            handleChoiceChangeWrittenQuestion={
              handleChoiceChangeWrittenQuestion
            }
            handleRemoveChoiceWrittenQuestion={
              handleRemoveChoiceWrittenQuestion
            }
            handleAddChoiceWrittenQuestion={handleAddChoiceWrittenQuestion}
            initialRubrics={initialRubrics}
          />
        ) : null}
      </div>
    </div>
  );
}

export default TextBox;
