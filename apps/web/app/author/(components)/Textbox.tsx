"use client";

import Dropdown from "@/components/Dropdown";
import type { QuestionType, QuestionTypeDropdown } from "@/config/types";
import { useAuthorStore } from "@/stores/author";
import MarkdownEditor from "@components/MarkDownEditor";
import { ComponentPropsWithoutRef, useEffect, useRef, useState } from "react";
import MultipleAnswerSection from "./QuestionTypes/MultipleAnswerSection";
import WrittenQuestionView from "./QuestionTypes/WrittenQuestionView";

const questionTypes = [
  {
    label: "Text",
    description: "This question has a written answer",
    value: "TEXT",
  },
  {
    label: "Url",
    description: "This question has a written answer",
    value: "URL",
  },
  {
    label: "Single Answer",
    description: "This multiple choice should have exactly one answer.",
    value: "SINGLE_CORRECT",
  },
  {
    label: "Multiple Answer",
    description: "This multiple choice can have zero or more than one answer",
    value: "MULTIPLE_CORRECT",
  },
] as QuestionTypeDropdown[];
interface TextBoxProps extends ComponentPropsWithoutRef<"div"> {
  questionId: number;
}

function TextBox(props: TextBoxProps) {
  const { questionId, ...rest } = props;
  const [isLearnerView, setIsLearnerView] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [
    questions,
    setQuestions,
    removeQuestion,
    addQuestion,
    activeAssignmentId,
    modifyQuestion,
  ] = useAuthorStore((state) => [
    state.questions,
    state.setQuestions,
    state.removeQuestion,
    state.addQuestion,
    state.activeAssignmentId,
    state.modifyQuestion,
  ]);

  const question = questions.find((question) => question.id === questionId);

  const menuRef = useRef<HTMLDivElement>(null);
  const [choicesWrittenQuestion, setChoicesWrittenQuestion] = useState<
    string[]
  >([]);

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
    modifyQuestion(questionId, {
      question: value,
    });
  };
  function setQuestionType(questionType: QuestionType) {
    modifyQuestion(questionId, {
      type: questionType,
      // if question type is multiple choice, we need to set the scoring to null
      scoring:
        questionType === "MULTIPLE_CORRECT" || questionType === "SINGLE_CORRECT"
          ? null
          : question.scoring,
    });
  }

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
  return (
    <div
      {...rest}
      className={`relative flex flex-col flex-1 w-[64rem] rounded-md bg-white transition border-l-8 py-10 px-12 border-blue-700 gap-y-4`}
    >
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
      <div className="flex flex-col gap-y-2">
        Question
        <MarkdownEditor
          value={question.question}
          setValue={handleQuestionTextChange}
          textareaClassName="!min-h-[6.5rem] !max-h-72"
          className="bg-gray-600"
        />
      </div>
      <div className="flex flex-col gap-y-1">
        <p className="text-black font-inter leading-5">Question Type</p>
        <Dropdown
          questionType={question.type}
          setQuestionType={setQuestionType}
          questionTypes={questionTypes}
        />
      </div>
      {question.type === questionTypes[0].value ||
      question.type === questionTypes[1].value ? (
        <WrittenQuestionView questionId={questionId} />
      ) : null}

      {/* {questionType === questionTypes[0] ? (
            <SingleAnswerSection
              choices={question.choices}
              selectedChoiceSingleCorrect={selectedChoiceSingleCorrect}
              handleChoiceToggleSingleCorrect={handleChoiceToggleSingleCorrect}
              handleChoiceChangeSingleCorrect={handleChoiceChangeSingleCorrect}
              setChoicesSingleCorrect={setChoicesSingleCorrect}
            />
          ) : null} */}

      {question.type === questionTypes[3].value ? (
        <MultipleAnswerSection questionId={questionId} />
      ) : null}
    </div>
  );
}

export default TextBox;
