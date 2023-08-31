import { absoluteUrl } from "../lib/utils";
import { Question } from "./types";

const BASE_API_PATH = absoluteUrl("/api/v1");

export const BASE_API_ROUTES = {
  // default
  user: `${BASE_API_PATH}/user`,
  info: `${BASE_API_PATH}/info`,
  assets: `${BASE_API_PATH}/assets`,
  // assignments
  assignments: `${BASE_API_PATH}/assignments`,
  // admin
  admin: `${BASE_API_PATH}/admin`,
};

export interface LongFormQuestionData {
  type: "longForm";
  questionText: string;
  instructions: string;
  points: number;
}

export interface MultipleChoiceQuestionData {
  type: "multipleChoice";
  questionText: string;
  options: string[];
  points: number;
  correctOptions: string[];
}

export type QuestionData = LongFormQuestionData | MultipleChoiceQuestionData;

export const questionsData: Question[] = [
  {
    id: 1,
    assignmentID: 1,
    type: "TEXT",
    totalPoints: 10,
    question: "Describe the key elements of a project charter...",
  },
  {
    id: 2,
    assignmentID: 1,
    type: "SINGLE_CORRECT",
    totalPoints: 5,
    numRetries: 2,
    question: "Choose the correct option. What is 5 + 5?",
    choices: [
      { "10": true },
      { "15": false },
      { "-10": false },
      { "-15": false },
    ],
  },
  {
    id: 3,
    assignmentID: 1,
    type: "MULTIPLE_CORRECT",
    numRetries: 2,
    totalPoints: 5,
    question: "Which of the following is NOT a programming language?",
    choices: [
      { Python: true },
      { Java: true },
      { HTML: false },
      { "C++": true },
    ],
  },
  {
    id: 4,
    assignmentID: 2,
    type: "TRUE_FALSE",
    totalPoints: 3,
    question: "Is the Earth flat?",
    answer: false,
  },
  {
    id: 5,
    assignmentID: 2,
    type: "URL",
    totalPoints: 8,
    question: "Provide a link to a relevant resource.",
  },
  {
    id: 6,
    assignmentID: 3,
    type: "UPLOAD",
    totalPoints: 15,
    question: "Upload a screenshot of your completed code.",
  },
  {
    id: 7,
    assignmentID: 1,
    type: "SINGLE_CORRECT",
    totalPoints: 5,
    numRetries: 2,
    question: "Which one is not an OOP principle?",
    choices: [
      { Encapsulation: false },
      { Inheritance: false },
      { Multithreading: true },
      { Polymorphism: false },
    ],
  },
  {
    id: 8,
    assignmentID: 1,
    type: "MULTIPLE_CORRECT",
    numRetries: 2,
    totalPoints: 5,
    question: "Select all relational database systems:",
    choices: [
      { MySQL: true },
      { Oracle: true },
      { Photoshop: false },
      { PostgreSQL: true },
    ],
  },
  {
    id: 10,
    assignmentID: 1,
    type: "TRUE_FALSE",
    totalPoints: 3,
    question: "HTML stands for Hyper Text Markup Language?",
    answer: true,
  },
];
