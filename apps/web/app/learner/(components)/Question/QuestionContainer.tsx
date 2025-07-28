import { getLanguageName } from "@/app/Helpers/getLanguageName";
import MarkdownViewer from "@/components/MarkdownViewer";
import { QuestionDisplayType, QuestionStore, Scoring } from "@/config/types";
import { cn } from "@/lib/strings";
import { translateQuestion } from "@/lib/talkToBackend";
import languages from "@/public/languages.json";
import { useLearnerOverviewStore, useLearnerStore } from "@/stores/learner";
import {
  ArrowLongLeftIcon,
  ArrowLongRightIcon,
  LanguageIcon,
  TagIcon as OutlineTagIcon,
} from "@heroicons/react/24/outline";
import { TagIcon } from "@heroicons/react/24/solid";
import { motion } from "framer-motion";
import { ComponentPropsWithoutRef, useEffect, useState } from "react";
import RenderQuestion from "./RenderQuestion";
import ShowHideRubric from "./ShowHideRubric";

interface Props extends ComponentPropsWithoutRef<"section"> {
  question: QuestionStore;
  questionNumber: number;
  questionId: number;
  questionDisplay: QuestionDisplayType;
  lastQuestionNumber: number;
}

function Component(props: Props) {
  const {
    className,
    questionId,
    questionNumber,
    question,
    questionDisplay,
    lastQuestionNumber,
  } = props;
  const assignmentId = useLearnerOverviewStore((state) => state.assignmentId);
  const [activeQuestionNumber, setActiveQuestionNumber] = useLearnerStore(
    (state) => [state.activeQuestionNumber, state.setActiveQuestionNumber],
  );
  const setQuestionStatus = useLearnerStore((state) => state.setQuestionStatus);
  const getQuestionStatusById = useLearnerStore(
    (state) => state.getQuestionStatusById,
  );
  const setSelectedLanguage = useLearnerStore(
    (state) => state.setSelectedLanguage,
  );
  useEffect(() => {
    if (typeof question.scoring === "string") {
      question.scoring = JSON.parse(question.scoring) as Scoring;
    }
  }, [question.scoring]);
  const checkToShowRubric = () => {
    if (
      ["TEXT", "UPLOAD", "LINk_FILE", "URL"].includes(question.type) &&
      question.scoring.showRubricsToLearner &&
      question.scoring?.rubrics
    )
      return true;
    else return false;
  };
  const showPoints = question.scoring?.showPoints ?? false;
  // Get the questionStatus directly from the store
  const questionStatus = getQuestionStatusById
    ? getQuestionStatusById(questionId)
    : "unedited";

  let questionTypeText: string;
  if (question.type === "MULTIPLE_CORRECT") {
    questionTypeText = "MULTIPLE SELECT";
  } else if (question.type === "SINGLE_CORRECT") {
    questionTypeText = "MULTIPLE CHOICE";
  } else if (question.type === "TRUE_FALSE") {
    questionTypeText = "TRUE OR FALSE";
  } else {
    questionTypeText = question.type;
  }

  const handleFlaggingQuestion = () => {
    if (questionStatus === "flagged") {
      setQuestionStatus(questionId, "unflagged");
    } else {
      setQuestionStatus(questionId, "flagged");
    }
  };
  const translationOn = useLearnerStore((state) =>
    state.getTranslationOn(questionId),
  );
  const setTranslatedQuestion = useLearnerStore(
    (state) => state.setTranslatedQuestion,
  );
  const setTranslatedChoices = useLearnerStore(
    (state) => state.setTranslatedChoices,
  );
  const [userPreferedLanguage, setUserPreferredLanguage] = useLearnerStore(
    (state) => [state.userPreferedLanguage, state.setUserPreferedLanguage],
  );
  const [userPreferedLanguageName, setUserPreferredLanguageName] = useState<
    string | undefined
  >(undefined);
  (useEffect(() => {
    if (userPreferedLanguage) {
      setUserPreferredLanguageName(
        getLanguageName(userPreferedLanguage) || "English",
      );
    }
  }),
    [userPreferedLanguage]);
  const translatingWords = [
    "Translating",
    "Traduciendo",
    "Traduction",
    "Traduzione",
    "Übersetzen",
    "Tradução",
    "번역 중",
    "翻訳中",
    "ترجمة",
  ];
  const setTranslationOn = useLearnerStore((state) => state.setTranslationOn);
  const toggleTranslation = () => {
    setTranslationOn(questionId, !translationOn);

    if (
      !translationOn &&
      question.selectedLanguage !== userPreferedLanguageName
    ) {
      void fetchTranslation();
    }
  };

  const [globalLanguage, setGlobalLanguage] = useLearnerStore((state) => [
    state.globalLanguage,
    state.setGlobalLanguage,
  ]);
  const [loadingTranslation, setLoadingTranslation] = useState(false);
  const [currentWord, setCurrentWord] = useState(translatingWords[0]);

  useEffect(() => {
    if (!loadingTranslation) return;

    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % translatingWords.length;
      setCurrentWord(translatingWords[index]);
    }, 1200);

    return () => clearInterval(interval);
  }, [loadingTranslation]);
  const fetchTranslation = async () => {
    try {
      setLoadingTranslation(true);
      const translation = await translateQuestion(
        assignmentId,
        questionId,
        question,
        question.selectedLanguage,
        languages.find((lang) => lang.name === question.selectedLanguage)
          ?.code || "en",
      );

      setTranslatedQuestion(questionId, translation.translatedQuestion);
      if (translation.translatedChoices) {
        setTranslatedChoices(questionId, translation.translatedChoices);
      }
    } catch (error) {
      console.error("Error fetching translation:", error);
    } finally {
      setLoadingTranslation(false);
    }
  };
  useEffect(() => {
    if (
      translationOn &&
      question.selectedLanguage !== userPreferedLanguageName
    ) {
      void fetchTranslation();
    }
    if (question.selectedLanguage === userPreferedLanguageName) {
      setTranslatedQuestion(questionId, question.question);
    }
  }, [question.selectedLanguage]);
  useEffect(() => {
    if (!globalLanguage) {
      const browserLanguage = navigator.language || navigator.languages[0];
      const detectedLanguage =
        languages.find((lang) => lang.code === browserLanguage)?.name ||
        userPreferedLanguageName;

      setGlobalLanguage(detectedLanguage);
    }
  }, [globalLanguage, setGlobalLanguage]);

  useEffect(() => {
    if (!question.selectedLanguage) {
      setSelectedLanguage(
        questionId,
        globalLanguage || userPreferedLanguageName,
      );
    }
  }, [questionId, globalLanguage, setSelectedLanguage]);

  const handleLanguageChange = (newLanguage: string) => {
    setSelectedLanguage(questionId, newLanguage);
    if (newLanguage !== userPreferedLanguageName) {
      setGlobalLanguage(newLanguage);
    }
  };
  return (
    <section
      id={`item-${questionNumber}`}
      onClick={() => {
        if (questionDisplay === "ALL_PER_PAGE") {
          setActiveQuestionNumber(questionNumber);
        }
      }}
      className={cn(
        "flex bg-white rounded flex-col gap-y-4 p-6 relative shadow hover:shadow-md border ",
        className,
        `${activeQuestionNumber === questionNumber ? "border-violet-600" : ""}`,
      )}
    >
      <div className="flex justify-between items-center pb-4 border-b">
        <div className="flex items-center gap-x-2">
          <p className="text-gray-700 text-xl font-semibold">
            Question {questionNumber}
          </p>
          <span className="text-md text-gray-600">|</span>
          <span className="text-md text-gray-600">{questionTypeText}</span>
        </div>
        <div className="flex items-center gap-x-2">
          <button
            className="text-gray-600 font-medium flex items-center group gap-x-2 hover:text-violet-600 transition"
            onClick={handleFlaggingQuestion}
          >
            <Bookmark questionStatus={questionStatus} />
          </button>
          <span className="text-md text-violet-600 bg-violet-100 rounded-md px-2 py-1">
            {question.totalPoints} points
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-y-4">
        <div className="flex justify-between items-center">
          <MarkdownViewer
            className="text-gray-800 px-2 border-gray-300 flex-grow"
            id={`question-${question.id}-${userPreferedLanguage}`}
          >
            {question.translations?.[userPreferedLanguage]?.translatedText ??
              question.question}
          </MarkdownViewer>
          <div className="flex items-start gap-x-2 ml-auto ">
            <LanguageIcon
              className={`h-6 w-6 ${
                translationOn ? "text-violet-600" : "text-gray-600"
              }`}
            />
            <button
              type="button"
              onClick={toggleTranslation}
              className={cn(
                "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                translationOn ? "bg-violet-600" : "bg-gray-200",
              )}
              role="switch"
              aria-checked={translationOn}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  translationOn ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>
        </div>

        {translationOn && (
          <div className="flex flex-col gap-y-4 bg-gray-100 rounded-md p-4">
            <div className="flex items-center gap-x-2">
              <span className="text-gray-600 font-medium">
                {userPreferedLanguageName}
              </span>
              <ArrowLongRightIcon className="w-5 h-5 text-gray-600" />
              <select
                className="border border-gray-300 rounded-md p-2 w-[150px]"
                value={question.selectedLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.name}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
            {loadingTranslation ? (
              <motion.div
                className="flex items-center gap-x-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                <svg
                  className="animate-spin h-5 w-5 text-violet-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  ></path>
                </svg>

                <motion.div
                  key={currentWord}
                  className="text-violet-600 font-semibold text-lg shimmer"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.5 }}
                >
                  {currentWord}
                </motion.div>

                <div className="dots text-violet-600 font-semibold">...</div>
              </motion.div>
            ) : (
              <MarkdownViewer className="text-gray-800 px-2 border-gray-300 font-semibold">
                {question.translatedQuestion || question.question}
              </MarkdownViewer>
            )}
          </div>
        )}
      </div>
      {checkToShowRubric() && (
        <ShowHideRubric
          rubrics={question.scoring.rubrics}
          showPoints={showPoints}
        />
      )}

      <RenderQuestion
        questionType={question.type}
        question={{
          ...question,
          choices: question?.choices?.map((choice, index) =>
            question.translations?.[userPreferedLanguage]?.translatedChoices
              ? question.translations[userPreferedLanguage].translatedChoices[
                  index
                ]
              : choice,
          ),
        }}
      />

      {questionDisplay === "ONE_PER_PAGE" && (
        <div className="flex justify-between">
          <button
            onClick={() => setActiveQuestionNumber(questionNumber - 1)}
            disabled={questionNumber === 1}
            className="disabled:opacity-50 disabled:pointer-events-none text-gray-600 font-medium flex items-center group gap-x-2 hover:text-violet-600 transition"
          >
            <ArrowLongLeftIcon
              strokeWidth={2}
              className="w-5 h-5 transition-transform group-hover:-translate-x-1"
            />
            Previous Question
          </button>
          <button
            onClick={() => setActiveQuestionNumber(questionNumber + 1)}
            disabled={questionNumber === lastQuestionNumber}
            className="disabled:opacity-50 disabled:pointer-events-none text-gray-600 font-medium flex items-center group gap-x-2 hover:text-violet-600 transition"
          >
            Next Question
            <ArrowLongRightIcon
              strokeWidth={2}
              className="w-5 h-5 transition-transform group-hover:translate-x-1"
            />
          </button>
        </div>
      )}
    </section>
  );
}

export default Component;

function Bookmark({ questionStatus }) {
  return questionStatus === "flagged" ? (
    <TagIcon className="w-5 h-5 text-violet-600" />
  ) : (
    <OutlineTagIcon className="w-5 h-5 text-violet-600" />
  );
}
