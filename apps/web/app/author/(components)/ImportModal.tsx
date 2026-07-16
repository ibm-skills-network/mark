/* eslint-disable */
"use client";
import React, { useState, useRef } from "react";
import {
  XMarkIcon,
  DocumentArrowUpIcon,
  CheckIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { cn } from "@/lib/strings";
import type { QuestionAuthorStore, QuestionType } from "@/config/types";
import { generateTempQuestionId } from "@/lib/utils";
import { ResponseType } from "@/config/types";
import * as XLSX from "xlsx";
interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (
    questions: QuestionAuthorStore[],
    options: ImportOptions,
    assignmentData?: ParsedData,
  ) => void;
}

interface ImportOptions {
  replaceExisting: boolean;
  appendToExisting: boolean;
  validateQuestions: boolean;
  importChoices: boolean;
  importRubrics: boolean;
  importConfig: boolean;
  importAssignmentSettings: boolean;
  importChoiceFeedback: boolean;
}

interface ParsedData {
  questions?: QuestionAuthorStore[];
  assignment?: any;
  config?: any;
  feedbackConfig?: any;
  gradingCriteria?: any;
}

interface ValidationError {
  questionIndex: number;
  field: string;
  message: string;
}

const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>(
    [],
  );
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    replaceExisting: false,
    appendToExisting: true,
    validateQuestions: false,
    importChoices: true,
    importRubrics: true,
    importConfig: false,
    importAssignmentSettings: false,
    importChoiceFeedback: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [importStep, setImportStep] = useState<
    "upload" | "configure" | "review"
  >("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      void handleFileSelection(e.target.files[0]);
    }
  };
  const parseOLX = (olxText: string): ParsedData => {
    const questions: QuestionAuthorStore[] = [];
    const assignment: any = {};

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(olxText, "text/xml");

      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        throw new Error("Invalid XML format");
      }

      const questestinterop = xmlDoc.querySelector("questestinterop");
      if (questestinterop) {
        return parseQTIFormat(xmlDoc);
      }

      const sequential = xmlDoc.querySelector("sequential");
      if (sequential) {
        assignment.name =
          sequential.getAttribute("display_name") || "Imported Assignment";
      }

      const htmlElements = xmlDoc.querySelectorAll("html");
      htmlElements.forEach((html) => {
        const displayName = html.getAttribute("display_name");
        const content = html.textContent || "";

        if (displayName?.toLowerCase().includes("introduction")) {
          assignment.introduction = content.trim();
        } else if (displayName?.toLowerCase().includes("instruction")) {
          assignment.instructions = content.trim();
        } else if (displayName?.toLowerCase().includes("grading")) {
          assignment.gradingCriteria = content.trim();
        }
      });

      const problems = xmlDoc.querySelectorAll("problem");
      problems.forEach((problem, index) => {
        const question: Partial<QuestionAuthorStore> = {
          id: generateTempQuestionId(),
          alreadyInBackend: false,
          assignmentId: 0,
          index: index + 1,
          numRetries: 1,
          type: "TEXT" as QuestionType,
          responseType: "TEXT" as ResponseType,
          totalPoints: parseInt(problem.getAttribute("weight") || "1") || 1,
          question: "",
          scoring: { type: "CRITERIA_BASED", criteria: [] },
        };

        const displayName = problem.getAttribute("display_name");
        if (displayName) {
          question.question = displayName;
        }

        const multipleChoice = problem.querySelector("multiplechoiceresponse");
        const choiceResponse = problem.querySelector("choiceresponse");

        if (multipleChoice || choiceResponse) {
          question.type = multipleChoice
            ? "SINGLE_CORRECT"
            : "MULTIPLE_CORRECT";
          question.responseType = "OTHER" as ResponseType;

          const label = problem.querySelector("label");
          if (label && label.textContent) {
            question.question = label.textContent.trim();
          }

          const choices: any[] = [];
          const choiceElements = problem.querySelectorAll("choice");
          choiceElements.forEach((choice) => {
            const isCorrect = choice.getAttribute("correct") === "true";
            const choiceHint = choice.querySelector("choicehint");

            const choiceText = Array.from(choice.childNodes)
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent?.trim())
              .join(" ")
              .trim();

            choices.push({
              choice: choiceText || "",
              isCorrect,
              points: isCorrect ? 1 : 0,
              feedback: choiceHint?.textContent?.trim() || "",
            });
          });

          if (choices.length > 0) {
            question.choices = choices;
          }
        }

        const stringResponse = problem.querySelector("stringresponse");
        if (stringResponse) {
          question.type = "TEXT";
          question.responseType = "OTHER" as ResponseType;

          const label = problem.querySelector("label");
          if (label && label.textContent) {
            question.question = label.textContent.trim();
          }

          const textline = problem.querySelector("textline");
          if (textline) {
            const size = textline.getAttribute("size");
            if (size) {
              question.maxCharacters = parseInt(size) * 5;
            }
          }
        }

        const solution = problem.querySelector("solution");
        if (solution) {
          const solutionText = solution.textContent?.trim() || "";
          if (solutionText) {
            question.scoring = {
              type: "CRITERIA_BASED",
              rubrics: [
                {
                  rubricQuestion: "Grading Criteria",
                  criteria: [
                    {
                      id: generateTempQuestionId(),
                      points: question.totalPoints || 1,
                      description: solutionText,
                    },
                  ],
                },
              ],
            };
          }
        }

        questions.push(question as QuestionAuthorStore);
      });
    } catch (error) {
      throw new Error(
        `Failed to parse OLX: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    return {
      questions,
      assignment: Object.keys(assignment).length > 0 ? assignment : undefined,
    };
  };

  const parseQTIFormat = (xmlDoc: Document): ParsedData => {
    const questions: QuestionAuthorStore[] = [];
    const assignment: any = {};

    const assessment = xmlDoc.querySelector("assessment");
    if (assessment) {
      assignment.name = assessment.getAttribute("title") || "QTI Import";
    }

    const items = xmlDoc.querySelectorAll("item");
    items.forEach((item, index) => {
      const question: Partial<QuestionAuthorStore> = {
        id: generateTempQuestionId(),
        alreadyInBackend: false,
        assignmentId: 0,
        index: index + 1,
        numRetries: 1,
        type: "TEXT" as QuestionType,
        responseType: "OTHER" as ResponseType,
        totalPoints: 1,
        question: "",
        scoring: { type: "CRITERIA_BASED", criteria: [] },
      };

      const presentation = item.querySelector("presentation");
      if (presentation) {
        const material = presentation.querySelector("material > mattext");
        if (material) {
          let questionText = material.textContent || "";
          questionText = questionText.replace(/<[^>]*>/g, "").trim();
          question.question = questionText;
        }

        const responseLid = presentation.querySelector("response_lid");
        if (responseLid) {
          const cardinality = responseLid.getAttribute("rcardinality");
          question.type =
            cardinality === "Single" ? "SINGLE_CORRECT" : "MULTIPLE_CORRECT";
          question.responseType = "OTHER" as ResponseType;

          const choices: any[] = [];
          const responseLabels =
            presentation.querySelectorAll("response_label");

          responseLabels.forEach((label) => {
            const labelId = label.getAttribute("ident") || "";
            const choiceMaterial = label.querySelector("material > mattext");
            let choiceText = "";

            if (choiceMaterial) {
              choiceText = choiceMaterial.textContent || "";
              choiceText = choiceText.replace(/<[^>]*>/g, "").trim();
            }

            const isCorrect = isChoiceCorrect(item, labelId);

            choices.push({
              choice: choiceText,
              isCorrect,
              points: isCorrect ? 1 : 0,
              feedback: "",
            });
          });

          if (choices.length > 0) {
            question.choices = choices;
          }
        }

        const responseStr = presentation.querySelector("response_str");
        if (responseStr) {
          question.type = "TEXT";
          question.responseType = "OTHER" as ResponseType;

          const correctAnswers = getCorrectTextAnswers(item);
          if (correctAnswers.length > 0) {
            question.choices = correctAnswers.map((answer) => ({
              choice: answer,
              isCorrect: true,
              points: 1,
            }));
          }
        }
      }

      questions.push(question as QuestionAuthorStore);
    });

    return {
      questions,
      assignment: Object.keys(assignment).length > 0 ? assignment : undefined,
    };
  };

  const isChoiceCorrect = (item: Element, labelId: string): boolean => {
    const resprocessing = item.querySelector("resprocessing");
    if (!resprocessing) return false;

    const respconditions = resprocessing.querySelectorAll("respcondition");
    for (const condition of Array.from(respconditions)) {
      const varequal = condition.querySelector("conditionvar > varequal");
      if (varequal && varequal.textContent?.trim() === labelId) {
        const setvar = condition.querySelector("setvar");
        if (setvar && parseInt(setvar.textContent?.trim() || "0") > 0) {
          return true;
        }
      }
    }
    return false;
  };

  const getCorrectTextAnswers = (item: Element): string[] => {
    const answers: string[] = [];
    const resprocessing = item.querySelector("resprocessing");
    if (!resprocessing) return answers;

    const respconditions = resprocessing.querySelectorAll("respcondition");
    for (const condition of Array.from(respconditions)) {
      const varequal = condition.querySelector("conditionvar > varequal");
      if (varequal) {
        const setvar = condition.querySelector("setvar");
        if (setvar && parseInt(setvar.textContent?.trim() || "0") > 0) {
          const answerText = varequal.textContent?.trim();
          if (answerText) {
            answers.push(answerText);
          }
        }
      }
    }
    return answers;
  };

  const handleFileSelection = async (file: File) => {
    setSelectedFile(file);
    setIsProcessing(true);

    try {
      let data: ParsedData;

      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        data = await parseXLSX(file);
        setImportOptions((prev) => ({
          ...prev,
          importChoices: true,
          validateQuestions: true,
        }));
      } else {
        const text = await file.text();

        if (file.name.endsWith(".json")) {
          data = JSON.parse(text) as ParsedData;
        } else if (file.name.endsWith(".txt")) {
          if (
            text.includes("COURSERA ASSIGNMENT EXPORT") ||
            text.includes("[ASSIGNMENT_METADATA]") ||
            text.includes("[QUESTIONS]")
          ) {
            data = parseCoursera(text);
          } else {
            throw new Error(
              "Unrecognized text file format. Expected Coursera format with section headers like [QUESTIONS].",
            );
          }
        } else if (file.name.endsWith(".xml")) {
          data = parseOLX(text);
        } else if (file.name.endsWith(".docx")) {
          throw new Error(
            "Microsoft Word documents not yet supported. Please export as text, YAML, or XML.",
          );
        } else if (file.name.endsWith(".zip")) {
          throw new Error(
            "IMS QTI zip files not yet supported. Please extract individual XML files from the package.",
          );
        } else {
          throw new Error(
            "Unsupported file format. Please use JSON, Excel (.xlsx), Coursera (.txt), QTI (.xml), or OLX (.xml) files.",
          );
        }
      }

      if (!data.questions || data.questions.length === 0) {
        throw new Error(
          "No questions found in the file. Please check the file format and content.",
        );
      }
      setParsedData(data);

      if (importOptions.validateQuestions && data.questions) {
        const errors = validateQuestions(data.questions);
        setValidationErrors(errors);
      }

      setImportStep("configure");
    } catch (error) {
      alert(
        `Failed to parse file: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setSelectedFile(null);
    } finally {
      setIsProcessing(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars

  const parseCoursera = (courseraText: string): ParsedData => {
    const questions: QuestionAuthorStore[] = [];
    const assignment: any = {};
    const config: any = {};

    const lines = courseraText.split("\n");
    let currentSection = "";
    let currentQuestionIndex = -1;
    let currentQuestion: Partial<QuestionAuthorStore> | null = null;
    let currentChoices: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("[") && line.endsWith("]")) {
        currentSection = line;
        continue;
      }

      if (currentSection === "[ASSIGNMENT_METADATA]" && line.includes(":")) {
        const [key, ...valueParts] = line.split(":");
        const value = valueParts.join(":").trim();
        if (key === "title") assignment.name = value;
        if (key === "learning_objectives")
          assignment.learningObjectives = value;
      }

      if (currentSection === "[ASSIGNMENT_CONFIG]" && line.includes(":")) {
        const [key, ...valueParts] = line.split(":");
        const value = valueParts.join(":").trim();
        if (key === "assignment_type") config.graded = value === "graded";
        if (key === "max_attempts")
          config.numAttempts =
            value === "unlimited" ? -1 : parseInt(value) || 1;
        if (key === "time_limit_minutes")
          config.allotedTimeMinutes =
            value === "no_limit" ? null : parseInt(value) || null;
        if (key === "passing_grade_percent")
          config.passingGrade = parseInt(value) || 70;
        if (key === "question_display")
          config.questionDisplay = value.toUpperCase().replace(/ /g, "_");
        if (key === "questions_per_attempt")
          config.numberOfQuestionsPerAttempt = parseInt(value) || null;
      }

      if (currentSection === "[ASSIGNMENT_INSTRUCTIONS]") {
        if (!assignment.introduction) assignment.introduction = "";
        if (line) assignment.introduction += line + "\n";
      }

      if (currentSection === "[LEARNER_INSTRUCTIONS]") {
        if (!assignment.instructions) assignment.instructions = "";
        if (line) assignment.instructions += line + "\n";
      }

      if (currentSection === "[GRADING_CRITERIA]") {
        if (!assignment.gradingCriteria) assignment.gradingCriteria = "";
        if (line) assignment.gradingCriteria += line + "\n";
      }

      if (currentSection === "[QUESTIONS]") {
        if (line.startsWith("Question_")) {
          if (currentQuestion) {
            if (currentChoices.length > 0) {
              currentQuestion.choices = currentChoices;
            }
            questions.push({
              ...currentQuestion,
              id: generateTempQuestionId(),
              alreadyInBackend: false,
              assignmentId: 0,
              index: questions.length + 1,
              numRetries: 1,
              scoring: currentQuestion.scoring || {
                type: "CRITERIA_BASED",
                criteria: [],
              },
            } as QuestionAuthorStore);
          }

          currentQuestion = {
            type: "TEXT" as QuestionType,
            question: "",
            responseType: "OTHER" as ResponseType,
            totalPoints: 1,
          };
          currentChoices = [];
          currentQuestionIndex++;
        } else if (line.includes(":") && currentQuestion) {
          const [key, ...valueParts] = line.split(":");
          const value = valueParts.join(":").trim();

          switch (key.trim()) {
            case "type":
              if (value === "SINGLE_CORRECT" || value === "MULTIPLE_CORRECT") {
                currentQuestion.type = value as QuestionType;
              } else if (
                value === "TEXT" ||
                value === "URL" ||
                value === "UPLOAD"
              ) {
                currentQuestion.type = value as QuestionType;
              } else {
                currentQuestion.type = "TEXT" as QuestionType;
              }
              break;
            case "points":
              currentQuestion.totalPoints = parseInt(value) || 1;
              break;
            case "prompt":
              currentQuestion.question = value;
              break;
            case "response_type":
              currentQuestion.responseType =
                value.toUpperCase() as ResponseType;
              break;
            case "max_words":
              currentQuestion.maxWords = parseInt(value) || null;
              break;
            case "max_characters":
              currentQuestion.maxCharacters = parseInt(value) || null;
              break;
          }
        } else if (line.match(/^\s*[A-Z]\.\s+/) && currentQuestion) {
          const choiceMatch = line.match(
            /^\s*([A-Z])\.\s+(.+?)(\s+\[CORRECT\])?(\s+\((\d+)\s+pts\))?$/,
          );
          if (choiceMatch) {
            const choiceText = choiceMatch[2];
            const isCorrect = !!choiceMatch[3];
            const points = choiceMatch[5]
              ? parseInt(choiceMatch[5])
              : isCorrect
                ? 1
                : 0;

            currentChoices.push({
              choice: choiceText,
              isCorrect,
              points,
            });
          }
        }
      }
    }

    if (currentQuestion) {
      if (currentChoices.length > 0) {
        currentQuestion.choices = currentChoices;
      }
      questions.push({
        ...currentQuestion,
        id: generateTempQuestionId(),
        alreadyInBackend: false,
        assignmentId: 0,
        index: questions.length + 1,
        numRetries: 1,
        scoring: currentQuestion.scoring || {
          type: "CRITERIA_BASED",
          criteria: [],
        },
      } as QuestionAuthorStore);
    }

    return {
      questions,
      assignment: Object.keys(assignment).length > 0 ? assignment : undefined,
      config: Object.keys(config).length > 0 ? config : undefined,
    };
  };

  const parseXLSX = async (file: File): Promise<ParsedData> => {
    const questions: QuestionAuthorStore[] = [];

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });

      const quizSheetName =
        workbook.SheetNames.find((name) =>
          name.toLowerCase().includes("quiz questions"),
        ) ||
        workbook.SheetNames.find((name) =>
          name.toLowerCase().includes("questions_master"),
        ) ||
        workbook.SheetNames[0];

      const worksheet = workbook.Sheets[quizSheetName];

      if (!worksheet) {
        throw new Error(
          "Could not find a sheet with quiz questions. Expected a sheet named 'QUIZ QUESTIONS_MASTER'.",
        );
      }

      const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
      });

      if (!rows.length) {
        throw new Error("Excel sheet is empty.");
      }

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        if (!row || row.length === 0) continue;

        const questionText = (row[0] ?? "").toString().trim();
        const correctAnswer = (row[1] ?? "").toString().trim();
        const answer2 = (row[2] ?? "").toString().trim();
        const answer3 = (row[3] ?? "").toString().trim();
        const answer4 = (row[4] ?? "").toString().trim();
        const answerLocation = (row[5] ?? "").toString().trim();
        const additionalInfo = (row[6] ?? "").toString().trim();

        if (!questionText) continue;

        const question: Partial<QuestionAuthorStore> = {
          id: generateTempQuestionId(),
          alreadyInBackend: false,
          assignmentId: 0,
          index: questions.length + 1,
          numRetries: 1,
          type: "SINGLE_CORRECT" as QuestionType,
          responseType: "OTHER" as ResponseType,
          totalPoints: 1,
          question: questionText,
          scoring: { type: "CRITERIA_BASED", criteria: [] },
        };

        const choices: any[] = [];

        if (correctAnswer) {
          choices.push({
            choice: correctAnswer,
            isCorrect: true,
            points: 1,
            feedback: additionalInfo
              ? `You may find answer for this question at ${additionalInfo}`
              : "",
          });
        }

        [answer2, answer3, answer4].forEach((answer) => {
          if (answer) {
            choices.push({
              choice: answer,
              isCorrect: false,
              points: 0,
              feedback: answerLocation
                ? `You may find answer for this question at ${answerLocation}`
                : "",
            });
          }
        });

        if (choices.length < 2) {
          continue;
        }

        question.choices = choices;

        questions.push(question as QuestionAuthorStore);
      }

      if (!questions.length) {
        throw new Error(
          "No questions parsed from Excel. Check that 'QUIZ QUESTIONS_MASTER' has data under the header row.",
        );
      }

      return {
        questions,
        assignment: {
          name: "Imported from Excel",
          introduction: `Imported ${questions.length} multiple-choice questions from sheet "${quizSheetName}" in ${file.name}`,
        },
      };
    } catch (error) {
      throw new Error(
        `Failed to parse Excel file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  };

  const validateQuestions = (
    questions: QuestionAuthorStore[],
  ): ValidationError[] => {
    const errors: ValidationError[] = [];

    questions.forEach((question, index) => {
      if (!question.question || question.question.trim() === "") {
        errors.push({
          questionIndex: index,
          field: "question",
          message: "Question text is required",
        });
      }

      if (!question.type || question.type === "EMPTY") {
        errors.push({
          questionIndex: index,
          field: "type",
          message: "Question type must be specified",
        });
      }

      if (
        (question.type === "SINGLE_CORRECT" ||
          question.type === "MULTIPLE_CORRECT") &&
        (!question.choices || question.choices.length === 0)
      ) {
        errors.push({
          questionIndex: index,
          field: "choices",
          message: "Multiple choice questions must have choices",
        });
      }

      if (
        (question.type === "SINGLE_CORRECT" ||
          question.type === "MULTIPLE_CORRECT" ||
          question.type === "TRUE_FALSE") &&
        question.choices &&
        question.choices.length > 0
      ) {
        const hasValidPoints = question.choices.some(
          (choice) => typeof choice.points === "number",
        );
        if (!hasValidPoints) {
          errors.push({
            questionIndex: index,
            field: "choices",
            message: "Choice points are missing or invalid",
          });
        }
      }

      if (
        (question.type === "TEXT" ||
          question.type === "URL" ||
          question.type === "UPLOAD") &&
        (!question.scoring?.rubrics || question.scoring.rubrics.length === 0)
      ) {
        errors.push({
          questionIndex: index,
          field: "scoring",
          message:
            "Text-based questions should have rubric criteria (will be auto-generated if missing)",
        });
      }

      if (!question.totalPoints || question.totalPoints <= 0) {
        errors.push({
          questionIndex: index,
          field: "totalPoints",
          message: "Total points missing or invalid (will be auto-calculated)",
        });
      }
    });

    return errors;
  };

  const handleImportOptionChange = (option: keyof ImportOptions) => {
    setImportOptions((prev) => {
      const newOptions = { ...prev, [option]: !prev[option] };

      if (option === "replaceExisting" && newOptions.replaceExisting) {
        newOptions.appendToExisting = false;
      } else if (option === "appendToExisting" && newOptions.appendToExisting) {
        newOptions.replaceExisting = false;
      }

      return newOptions;
    });
  };

  const handleImport = () => {
    if (!parsedData?.questions) return;

    let questionsToImport = parsedData.questions;

    if (!importOptions.importChoices) {
      questionsToImport = questionsToImport.map((q) => ({
        ...q,
        choices: undefined,
      }));
    }

    if (!importOptions.importChoiceFeedback && importOptions.importChoices) {
      questionsToImport = questionsToImport.map((q) => ({
        ...q,
        choices: q.choices?.map((choice) => ({
          ...choice,
          feedback: "",
        })),
      }));
    }

    if (!importOptions.importRubrics) {
      questionsToImport = questionsToImport.map((q) => ({
        ...q,
        scoring: {
          type: "CRITERIA_BASED",
          criteria: [],
        },
      }));
    }

    onImport(questionsToImport, importOptions, parsedData);
    handleClose();
  };

  const handleClose = () => {
    setSelectedFile(null);
    setParsedData(null);
    setValidationErrors([]);
    setImportStep("upload");
    setIsProcessing(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <DocumentArrowUpIcon className="w-6 h-6 text-purple-600 dark:text-purple-300" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Import Questions
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          {importStep === "upload" && (
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                  Select File to Import
                </h3>

                <div
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                    dragActive
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-300 dark:border-gray-600 hover:border-gray-400",
                  )}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <DocumentArrowUpIcon className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                  <p className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                    Drop your file here, or{" "}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-purple-600 dark:text-purple-300 hover:text-purple-700 underline"
                    >
                      browse
                    </button>
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Supports JSON, Excel (.xlsx), Open edX (.xml)
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.txt,.xml,.zip,.xlsx,.xls"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </div>

                {selectedFile && (
                  <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <CheckIcon className="w-5 h-5 text-green-600 dark:text-green-300 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-green-900 dark:text-green-200">
                        {selectedFile.name}
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                )}

                {isProcessing && (
                  <div className="flex items-center gap-3 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600"></div>
                    <p className="text-purple-900 dark:text-purple-200">Processing file...</p>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
                  Supported Formats
                </h4>
                <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                  <li>
                    <strong>JSON:</strong> Complete assignment exports with all
                    question data
                  </li>
                  <li>
                    <strong>Excel (.xlsx):</strong> Quiz format with question
                    text and 4 answer choices (first column is correct answer)
                  </li>
                  <li>
                    <strong>Open edX OLX (.xml):</strong> Open Learning XML
                    format
                  </li>
                </ul>
              </div>
            </div>
          )}

          {importStep === "configure" && parsedData && (
            <div className="space-y-6">
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                <h3 className="font-medium text-purple-900 dark:text-purple-200 mb-2">
                  Import Summary
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-purple-700 dark:text-purple-300">Questions found: </span>
                    <span className="font-medium">
                      {parsedData.questions?.length || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-purple-700 dark:text-purple-300">File format: </span>
                    <span className="font-medium">
                      {selectedFile?.name.split(".").pop()?.toUpperCase()}
                    </span>
                  </div>
                  {parsedData.assignment && (
                    <div>
                      <span className="text-purple-700 dark:text-purple-300">Assignment data: </span>
                      <span className="font-medium">Available</span>
                    </div>
                  )}
                  {parsedData.config && (
                    <div>
                      <span className="text-purple-700 dark:text-purple-300">Configuration: </span>
                      <span className="font-medium">Available</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                  Import Options
                </h3>

                <div className="space-y-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        id="append"
                        checked={importOptions.appendToExisting}
                        onChange={() =>
                          handleImportOptionChange("appendToExisting")
                        }
                        className="text-purple-600 dark:text-purple-300 focus:ring-purple-500"
                      />

                      <label
                        htmlFor="append"
                        className="font-medium text-gray-900 dark:text-gray-100"
                      >
                        Add to existing questions
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        id="replace"
                        checked={importOptions.replaceExisting}
                        onChange={() =>
                          handleImportOptionChange("replaceExisting")
                        }
                        className="text-purple-600 dark:text-purple-300 focus:ring-purple-500"
                      />

                      <label
                        htmlFor="replace"
                        className="font-medium text-gray-900 dark:text-gray-100"
                      >
                        Replace all existing questions
                      </label>
                    </div>
                  </div>

                  {[
                    {
                      id: "importChoices",
                      label: "Import question choices",
                      description:
                        selectedFile?.name.endsWith(".xlsx") ||
                        selectedFile?.name.endsWith(".xls")
                          ? "Required for Excel imports (always enabled)"
                          : "Include multiple choice options",
                    },
                    ...(selectedFile?.name.endsWith(".xlsx") ||
                    selectedFile?.name.endsWith(".xls")
                      ? [
                          {
                            id: "importChoiceFeedback",
                            label: "Import choice feedback from Excel",
                            description:
                              "Adds 'Additional Info' as feedback on correct answer, and 'Answer Location' as feedback on incorrect answers",
                          },
                        ]
                      : []),
                    {
                      id: "importRubrics",
                      label: "Import rubrics and scoring",
                      description: "Include grading criteria",
                    },
                    {
                      id: "importAssignmentSettings",
                      label: "Import assignment settings",
                      description:
                        "Include assignment metadata, config, and instructions",
                    },
                    {
                      id: "validateQuestions",
                      label: "Validate imported questions",
                      description: "Check for required fields and errors",
                    },
                  ].map((option) => (
                    <div
                      key={option.id}
                      className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
                    >
                      <input
                        type="checkbox"
                        id={option.id}
                        checked={
                          importOptions[option.id as keyof ImportOptions]
                        }
                        onChange={() =>
                          handleImportOptionChange(
                            option.id as keyof ImportOptions,
                          )
                        }
                        className="mt-0.5 text-purple-600 dark:text-purple-300 focus:ring-purple-500"
                      />

                      <div>
                        <label
                          htmlFor={option.id}
                          className="font-medium text-gray-900 dark:text-gray-100"
                        >
                          {option.label}
                        </label>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          {option.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {validationErrors.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-300" />
                    <h4 className="font-medium text-red-900 dark:text-red-200">
                      Validation Errors
                    </h4>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {validationErrors.map((error, idx) => (
                      <div key={idx} className="text-sm text-red-800 dark:text-red-200">
                        <strong>Question {error.questionIndex + 1}:</strong>{" "}
                        {error.message} (field: {error.field})
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-2">
                    Note: Errors marked with "will be auto-generated" or "will
                    be auto-calculated" won't prevent import.
                  </p>
                </div>
              )}

              {importOptions.replaceExisting && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-300" />
                    <h4 className="font-medium text-yellow-900 dark:text-yellow-200">Warning</h4>
                  </div>
                  <p className="text-sm text-yellow-800 dark:text-yellow-200 mt-1">
                    This will permanently delete all existing questions and
                    replace them with the imported ones.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>

          {importStep === "configure" && (
            <button
              onClick={handleImport}
              disabled={
                !parsedData?.questions ||
                (importOptions.validateQuestions &&
                  validationErrors.filter(
                    (e) =>
                      !e.message.includes("will be auto-calculated") &&
                      !e.message.includes("will be auto-generated"),
                  ).length > 0)
              }
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <DocumentArrowUpIcon className="w-4 h-4" />
              Import {parsedData?.questions?.length || 0} Questions
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportModal;
