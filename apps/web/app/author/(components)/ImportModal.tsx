/* eslint-disable */
"use client";
import React, { useState, useRef } from "react";
import {
  XMarkIcon,
  DocumentArrowUpIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { cn } from "@/lib/strings";
import type { QuestionAuthorStore, QuestionType } from "@/config/types";
import { generateTempQuestionId } from "@/lib/utils";
import { ResponseType } from "@/config/types";
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
    validateQuestions: true,
    importChoices: true,
    importRubrics: true,
    importConfig: false,
    importAssignmentSettings: false,
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
      const text = await file.text();
      let data: ParsedData;

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
          "Unsupported file format. Please use JSON, Coursera (.txt), QTI (.xml), or OLX (.xml) files.",
        );
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
      console.error("File parsing error:", error);
      alert(
        `Failed to parse file: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setSelectedFile(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const parseCourseraYAML = (yamlText: string): ParsedData => {
    try {
      const yamlData = parseYAML(yamlText);

      if (
        Array.isArray(yamlData) &&
        yamlData.length > 0 &&
        yamlData[0].variations
      ) {
        return parseCourseraVariationsFormat(yamlData);
      }

      if (yamlData.assignment && yamlData.questions) {
        return parseCustomYAMLFormat(yamlData);
      }

      throw new Error(
        "Unrecognized YAML format. Expected either Coursera variations format or custom export format.",
      );
    } catch (error) {
      console.error("Error parsing YAML:", error);
      throw new Error(
        `Invalid YAML format: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const parseCourseraVariationsFormat = (yamlData: any[]): ParsedData => {
    const questions: QuestionAuthorStore[] = [];

    yamlData.forEach((item: any, index: number) => {
      if (!item.variations || !Array.isArray(item.variations)) return;

      item.variations.forEach((variation: any) => {
        const question: Partial<QuestionAuthorStore> = {
          id: generateTempQuestionId(),
          alreadyInBackend: false,
          assignmentId: 0,
          index: questions.length + 1,
          numRetries: 1,
          question: variation.prompt || "",
          totalPoints: 1,
          scoring: { type: "CRITERIA_BASED", criteria: [] },
        };

        switch (variation.typeName) {
          case "multipleChoice":
            question.type = "SINGLE_CORRECT";
            question.responseType = "OTHER" as ResponseType;
            break;
          case "text":
            question.type = "TEXT";
            question.responseType = "OTHER" as ResponseType;
            break;
          case "checkbox":
            question.type = "MULTIPLE_CORRECT";
            question.responseType = "OTHER" as ResponseType;
            break;
          default:
            question.type = "TEXT";
            question.responseType = "OTHER" as ResponseType;
        }

        if (variation.options && Array.isArray(variation.options)) {
          question.choices = variation.options.map((option: any) => ({
            choice: option.answer || "",
            isCorrect: option.isCorrect || false,
            points: option.isCorrect ? 1 : 0,
            feedback: option.feedback || "",
          }));
        }

        if (variation.answers && Array.isArray(variation.answers)) {
          const correctAnswers = variation.answers.filter(
            (answer: any) => answer.isCorrect,
          );
          if (correctAnswers.length > 0) {
            question.choices = correctAnswers.map((answer: any) => ({
              choice: answer.answer || "",
              isCorrect: true,
              points: 1,
              feedback: answer.feedback || "",
            }));
          } else {
            question.choices = variation.answers.map((answer: any) => ({
              choice: answer.answer || "",
              isCorrect: answer.isCorrect || false,
              points: answer.isCorrect ? 1 : 0,
              feedback: answer.feedback || "",
            }));
          }
        }

        if (variation.defaultFeedback) {
          question.question =
            question.question +
            (question.question ? "\n\n" : "") +
            `[Default Feedback: ${variation.defaultFeedback}]`;
        }

        if (variation.shuffleOptions !== undefined) {
        }

        questions.push(question as QuestionAuthorStore);
      });
    });

    return {
      questions,
      assignment: {
        name: "Imported from Coursera YAML",
        introduction: `Imported ${questions.length} questions from Coursera format`,
      },
      config: undefined,
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const parseCSV = (csvText: string): ParsedData => {
    const lines = csvText.split("\n").filter((line) => line.trim());
    const questions: QuestionAuthorStore[] = [];
    let currentSection = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === "Questions") {
        currentSection = "questions";
        i++;
        continue;
      }

      if (currentSection === "questions" && line) {
        const columns = line.split(",").map((col) => col.replace(/^"|"$/g, ""));
        if (columns.length >= 3) {
          const questionType = columns[0] as QuestionType;
          const questionText = columns[1];
          const responseType = columns[2] as ResponseType;
          const totalPoints = columns[3]
            ? parseInt(columns[3])
            : questionType === "TEXT"
              ? 10
              : questionType === "URL" ||
                  questionType === "UPLOAD" ||
                  questionType === "LINK_FILE"
                ? 10
                : 1;

          questions.push({
            id: generateTempQuestionId(),
            type: questionType,
            question: questionText,
            responseType: responseType,
            alreadyInBackend: false,
            assignmentId: 0,
            index: questions.length + 1,
            totalPoints: totalPoints,
            numRetries: 1,
            scoring: {
              type: "CRITERIA_BASED",
              criteria: [],
            },

            choices:
              questionType === "SINGLE_CORRECT" ||
              questionType === "MULTIPLE_CORRECT" ||
              questionType === "TRUE_FALSE"
                ? [
                    {
                      choice: "Option 1",
                      isCorrect: true,
                      points: 1,
                    },
                    {
                      choice: "Option 2",
                      isCorrect: false,
                      points: 0,
                    },
                  ]
                : undefined,
          });
        }
      }
    }

    return { questions };
  };

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

  const parseCustomYAMLFormat = (yamlData: any): ParsedData => {
    const questions: QuestionAuthorStore[] = [];
    let assignment: any = {};
    let config: any = {};

    if (yamlData.assignment) {
      const assignmentData = yamlData.assignment;
      assignment = {
        name: assignmentData.title || "Imported Assignment",
        learningObjectives: assignmentData.learning_objectives,
        introduction: assignmentData.instructions,
        instructions: assignmentData.learner_instructions,
      };

      config = {
        graded: assignmentData.assignment_type === "graded",
        numAttempts:
          assignmentData.max_attempts === "unlimited"
            ? -1
            : parseInt(assignmentData.max_attempts) || 1,
        allotedTimeMinutes: assignmentData.time_limit_minutes || null,
        passingGrade: assignmentData.passing_grade_percent || 70,
        questionDisplay: assignmentData.question_display || "all_at_once",
        numberOfQuestionsPerAttempt:
          assignmentData.questions_per_attempt || null,
      };
    }

    if (yamlData.questions && Array.isArray(yamlData.questions)) {
      yamlData.questions.forEach((questionData: any, index: number) => {
        const question: Partial<QuestionAuthorStore> = {
          id: generateTempQuestionId(),
          alreadyInBackend: false,
          assignmentId: 0,
          index: index + 1,
          numRetries: 1,
          type: questionData.type || "TEXT",
          question: questionData.prompt || "",
          responseType: questionData.response_type || "OTHER",
          totalPoints: questionData.points || 1,
          maxWords: questionData.max_words || null,
          maxCharacters: questionData.max_characters || null,
          scoring: { type: "CRITERIA_BASED", criteria: [] },
        };

        if (questionData.choices && Array.isArray(questionData.choices)) {
          question.choices = questionData.choices.map((choice: any) => ({
            choice: choice.text || choice.id || "",
            isCorrect: choice.is_correct || false,
            points: choice.points || 0,
          }));
        }

        if (questionData.rubrics && Array.isArray(questionData.rubrics)) {
          const rubrics = questionData.rubrics.map((rubric: any) => ({
            rubricQuestion: rubric.rubric_question || "",
            criteria:
              rubric.criteria?.map((criterion: any) => ({
                points: criterion.points || 0,
                description: criterion.description || "",
              })) || [],
          }));
          question.scoring = { type: "CRITERIA_BASED", rubrics };
        }

        questions.push(question as QuestionAuthorStore);
      });
    }

    return {
      questions,
      assignment: Object.keys(assignment).length > 0 ? assignment : undefined,
      config: Object.keys(config).length > 0 ? config : undefined,
    };
  };

  const parseYAML = (yamlText: string): any => {
    const lines = yamlText.split("\n");

    const firstNonEmptyLine = lines.find(
      (line) => line.trim() && !line.trim().startsWith("#"),
    );
    const isRootArray = firstNonEmptyLine?.trim().startsWith("-");

    if (isRootArray) {
      return parseYAMLArray(lines);
    } else {
      return parseYAMLObject(lines);
    }
  };

  const parseYAMLArray = (lines: string[]): any[] => {
    const result: any[] = [];
    let currentItem: any = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) continue;

      const indent = line.length - line.trimStart().length;

      if (trimmedLine.startsWith("-")) {
        if (currentItem !== null) {
          result.push(currentItem);
        }
        currentItem = {};

        const contentAfterDash = trimmedLine.substring(1).trim();
        if (contentAfterDash) {
          const colonIndex = contentAfterDash.indexOf(":");
          if (colonIndex > 0) {
            const key = contentAfterDash.substring(0, colonIndex).trim();
            const value = contentAfterDash.substring(colonIndex + 1).trim();
            currentItem[key] = parseYAMLValue(value);
          }
        }
      } else if (currentItem && trimmedLine.includes(":")) {
        const colonIndex = trimmedLine.indexOf(":");
        const key = trimmedLine.substring(0, colonIndex).trim();
        const value = trimmedLine.substring(colonIndex + 1).trim();

        if (value === "" || value === "[]") {
          if (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
            const nestedArray: any[] = [];
            i++;

            while (i < lines.length) {
              const nextLine = lines[i];
              const nextTrimmed = nextLine.trim();
              const nextIndent = nextLine.length - nextLine.trimStart().length;

              if (!nextTrimmed || nextIndent <= indent) {
                i--;
                break;
              }

              if (nextTrimmed.startsWith("-")) {
                const itemContent = nextTrimmed.substring(1).trim();
                if (itemContent === "") {
                  const nestedItem: any = {};
                  i++;

                  while (i < lines.length) {
                    const propLine = lines[i];
                    const propTrimmed = propLine.trim();
                    const propIndent =
                      propLine.length - propLine.trimStart().length;

                    if (!propTrimmed || propIndent <= nextIndent) {
                      i--;
                      break;
                    }

                    if (propTrimmed.includes(":")) {
                      const propColonIndex = propTrimmed.indexOf(":");
                      const propKey = propTrimmed
                        .substring(0, propColonIndex)
                        .trim();
                      const propValue = propTrimmed
                        .substring(propColonIndex + 1)
                        .trim();
                      nestedItem[propKey] = parseYAMLValue(propValue);
                    }
                    i++;
                  }
                  nestedArray.push(nestedItem);
                } else {
                  nestedArray.push(parseYAMLValue(itemContent));
                }
              }
              i++;
            }
            currentItem[key] = nestedArray;
          } else {
            currentItem[key] = {};
          }
        } else {
          currentItem[key] = parseYAMLValue(value);
        }
      }
    }

    if (currentItem !== null) {
      result.push(currentItem);
    }

    return result;
  };

  const parseYAMLObject = (lines: string[]): any => {
    const result: any = {};
    let currentObj = result;
    let currentPath: string[] = [];
    let currentArray: any[] | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) continue;

      const indent = line.length - line.trimStart().length;
      const colonIndex = trimmedLine.indexOf(":");

      if (colonIndex > 0) {
        const key = trimmedLine.substring(0, colonIndex).trim();
        const value = trimmedLine.substring(colonIndex + 1).trim();

        const level = Math.floor(indent / 2);

        currentPath = currentPath.slice(0, level);

        currentObj = result;
        for (const pathKey of currentPath) {
          if (!currentObj[pathKey]) currentObj[pathKey] = {};
          currentObj = currentObj[pathKey];
        }

        if (value === "" || value === "[]") {
          if (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
            currentObj[key] = [];
            currentArray = currentObj[key];
          } else {
            currentObj[key] = {};
            currentPath.push(key);
          }
        } else {
          currentObj[key] = parseYAMLValue(value);
        }
      } else if (trimmedLine.startsWith("-")) {
        if (currentArray) {
          const itemText = trimmedLine.substring(1).trim();
          if (itemText === "") {
            const arrayItem: any = {};
            currentArray.push(arrayItem);

            let j = i + 1;
            while (j < lines.length) {
              const nextLine = lines[j];
              const nextTrimmed = nextLine.trim();
              const nextIndent = nextLine.length - nextLine.trimStart().length;

              if (!nextTrimmed || nextIndent <= indent) break;

              const nextColonIndex = nextTrimmed.indexOf(":");
              if (nextColonIndex > 0) {
                const propKey = nextTrimmed.substring(0, nextColonIndex).trim();
                const propValue = nextTrimmed
                  .substring(nextColonIndex + 1)
                  .trim();
                arrayItem[propKey] = parseYAMLValue(propValue);
              }
              j++;
            }
            i = j - 1;
          } else {
            currentArray.push(parseYAMLValue(itemText));
          }
        }
      }
    }

    return result;
  };

  const parseYAMLValue = (value: string): any => {
    if (value === "null") return null;
    if (value === "true") return true;
    if (value === "false") return false;
    if (!isNaN(Number(value)) && value !== "") return Number(value);

    return value.replace(/^["']|["']$/g, "");
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
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <DocumentArrowUpIcon className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Import Questions
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          {importStep === "upload" && (
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Select File to Import
                </h3>

                <div
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                    dragActive
                      ? "border-purple-500 bg-purple-50"
                      : "border-gray-300 hover:border-gray-400",
                  )}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <DocumentArrowUpIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-lg font-medium text-gray-900 mb-2">
                    Drop your file here, or{" "}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-purple-600 hover:text-purple-700 underline"
                    >
                      browse
                    </button>
                  </p>
                  <p className="text-sm text-gray-500">
                    Supports JSON, Open edX (.xml)
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.txt,.xml,.zip"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </div>

                {selectedFile && (
                  <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <CheckIcon className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-green-900">
                        {selectedFile.name}
                      </p>
                      <p className="text-sm text-green-700">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                )}

                {isProcessing && (
                  <div className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600"></div>
                    <p className="text-purple-900">Processing file...</p>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-2">
                  Supported Formats
                </h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>
                    <strong>JSON:</strong> Complete assignment exports with all
                    question data
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
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h3 className="font-medium text-purple-900 mb-2">
                  Import Summary
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-purple-700">Questions found: </span>
                    <span className="font-medium">
                      {parsedData.questions?.length || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-purple-700">File format: </span>
                    <span className="font-medium">
                      {selectedFile?.name.split(".").pop()?.toUpperCase()}
                    </span>
                  </div>
                  {parsedData.assignment && (
                    <div>
                      <span className="text-purple-700">Assignment data: </span>
                      <span className="font-medium">Available</span>
                    </div>
                  )}
                  {parsedData.config && (
                    <div>
                      <span className="text-purple-700">Configuration: </span>
                      <span className="font-medium">Available</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900">
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
                        className="text-purple-600 focus:ring-purple-500"
                      />

                      <label
                        htmlFor="append"
                        className="font-medium text-gray-900"
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
                        className="text-purple-600 focus:ring-purple-500"
                      />

                      <label
                        htmlFor="replace"
                        className="font-medium text-gray-900"
                      >
                        Replace all existing questions
                      </label>
                    </div>
                  </div>

                  {[
                    {
                      id: "importChoices",
                      label: "Import question choices",
                      description: "Include multiple choice options",
                    },
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
                      className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg"
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
                        className="mt-0.5 text-purple-600 focus:ring-purple-500"
                      />

                      <div>
                        <label
                          htmlFor={option.id}
                          className="font-medium text-gray-900"
                        >
                          {option.label}
                        </label>
                        <p className="text-sm text-gray-600">
                          {option.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {importOptions.replaceExisting && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600" />
                    <h4 className="font-medium text-yellow-900">Warning</h4>
                  </div>
                  <p className="text-sm text-yellow-800 mt-1">
                    This will permanently delete all existing questions and
                    replace them with the imported ones.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
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
