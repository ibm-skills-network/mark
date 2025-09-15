import {
  getLanguageCode,
  getLanguageName,
} from "@/app/Helpers/getLanguageName";
import MarkdownViewer from "@/components/MarkdownViewer";
import { QuestionDisplayType, QuestionStore, Scoring } from "@/config/types";
import { cn } from "@/lib/strings";
import { translateQuestion } from "@/lib/talkToBackend";
import languages from "@/public/languages.json";
import { useLearnerOverviewStore, useLearnerStore } from "@/stores/learner";
import {
  ArrowLongLeftIcon,
  ArrowLongRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LanguageIcon,
  TagIcon as OutlineTagIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import { TagIcon } from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "framer-motion";
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
        // Extract choice text from Choice objects
        const choiceTexts = translation.translatedChoices.map((choice) =>
          typeof choice === "string"
            ? choice
            : choice?.choice || String(choice),
        );
        setTranslatedChoices(questionId, choiceTexts);
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
      if (question.choices) {
        // Extract choice text from Choice objects for consistency
        const choiceTexts = question.choices.map((choice) =>
          typeof choice === "string"
            ? choice
            : choice?.choice || String(choice),
        );
        setTranslatedChoices(questionId, choiceTexts);
      }
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

      {/* Question header with language toggle for all types */}
      <div className="flex justify-between items-center">
        <div className="flex-grow">
          <MarkdownViewer
            className="text-gray-800 px-2 border-gray-300"
            id={`question-${question.id}-${userPreferedLanguage}`}
          >
            {question.translations?.[userPreferedLanguage]?.translatedText ??
              question.question}
          </MarkdownViewer>
        </div>
        <div className="flex items-center gap-x-2 ml-4">
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
      {checkToShowRubric() && (
        <ShowHideRubric
          rubrics={question.scoring.rubrics}
          showPoints={showPoints}
        />
      )}
      {/* Render question based on type and translation state */}
      {translationOn ? (
        <>
          {/* Split view for SINGLE_CORRECT and MULTIPLE_CORRECT */}
          {question.type === "SINGLE_CORRECT" ||
          question.type === "MULTIPLE_CORRECT" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12 relative">
              {/* Arrow indicator - only on desktop */}
              <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                <ArrowRightIcon className="w-6 h-6 text-black" />
              </div>

              {/* Original Language Column */}
              <div className="space-y-3 lg:pr-6">
                <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {userPreferedLanguageName || "Original"}
                  </span>
                  <span className="text-xs px-2 py-1 bg-gray-100 rounded-full text-gray-600">
                    Original
                  </span>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 flex flex-col">
                  <div className="flex-grow">
                    <RenderQuestion
                      questionType={question.type}
                      question={{
                        ...question,
                        choices: question?.choices?.map((choice, index) =>
                          question.translations?.[userPreferedLanguage]
                            ?.translatedChoices
                            ? question.translations[userPreferedLanguage]
                                .translatedChoices[index]
                            : choice,
                        ),
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Translated Language Column */}
              <div className="space-y-3 lg:pl-6 border-t lg:border-t-0 pt-4 lg:pt-0 mt-4 lg:mt-0">
                <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                  <select
                    className="text-sm font-medium border border-gray-300 rounded px-2 py-1"
                    value={question.selectedLanguage}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                  >
                    {languages.map((lang) => (
                      <option key={lang.code} value={lang.name}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs px-2 py-1 bg-violet-100 rounded-full text-violet-600">
                    Translation
                  </span>
                </div>
                {loadingTranslation ? (
                  <div className="flex items-center justify-center py-8 min-h-[200px]">
                    <div className="text-center">
                      <div className="animate-pulse text-violet-600 mb-2">
                        {currentWord}...
                      </div>
                      <div className="text-sm text-gray-500">
                        Loading translation
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-violet-50 rounded-lg p-4 flex flex-col">
                    <div className="flex-grow">
                      <RenderQuestion
                        questionType={question.type}
                        question={{
                          ...question,
                          choices: question?.choices?.map((choice, index) =>
                            question.translations?.[
                              getLanguageCode(question.selectedLanguage)
                            ]?.translatedChoices
                              ? question.translations[
                                  getLanguageCode(question.selectedLanguage)
                                ].translatedChoices[index]
                              : choice,
                          ),
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* For other question types, show translation below */
            <div className="space-y-4">
              <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                <select
                  className="text-sm font-medium border border-gray-300 rounded px-2 py-1"
                  value={question.selectedLanguage}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                >
                  {languages.map((lang) => (
                    <option key={lang.code} value={lang.name}>
                      {lang.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs px-2 py-1 bg-violet-100 rounded-full text-violet-600">
                  Translation
                </span>
              </div>
              <MarkdownViewer className="text-gray-800 px-2 border-gray-300 font-semibold">
                {question.translatedQuestion || question.question}
              </MarkdownViewer>

              {/* Original Answer Field */}
              <RenderQuestion
                questionType={question.type}
                question={{
                  ...question,
                  choices: question?.choices?.map((choice, index) =>
                    question.translations?.[userPreferedLanguage]
                      ?.translatedChoices
                      ? question.translations[userPreferedLanguage]
                          .translatedChoices[index]
                      : choice,
                  ),
                }}
              />
            </div>
          )}
        </>
      ) : (
        /* Translation OFF - show normal view */
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
      )}

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
