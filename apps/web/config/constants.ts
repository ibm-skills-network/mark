import { absoluteUrl } from "../lib/utils";

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

export const questionsData: QuestionData[] = [
  {
    type: "longForm",
    questionText: "Describe the key elements of a project charter...",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Choose the correct option.",
    options: ["Option 1", "Option 2", "Option 3", "Option 4"],
    points: 5,
    correctOptions: ["Option 1", "Option 2"],
  },
  {
    type: "multipleChoice",
    questionText: "Which of the following is NOT a programming language?",
    options: ["Python", "Java", "HTML", "C++"],
    points: 5,
    correctOptions: ["HTML"],
  },
  {
    type: "multipleChoice",
    questionText: "What is the capital of France?",
    options: ["Paris", "London", "Berlin", "Madrid"],
    points: 5,
    correctOptions: ["Paris"],
  },
  {
    type: "longForm",
    questionText:
      "Explain the difference between classical and quantum computing.",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "longForm",
    questionText:
      "How does machine learning differ from traditional programming?",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which of these are cloud providers?",
    options: ["AWS", "Azure", "Oracle Cloud", "Photoshop"],
    points: 5,
    correctOptions: ["AWS", "Azure", "Oracle Cloud"],
  },
  {
    type: "longForm",
    questionText: "What is the importance of data integrity in a database?",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which languages are commonly used for web development?",
    options: ["Python", "JavaScript", "C#", "All of the above"],
    points: 5,
    correctOptions: ["Python", "JavaScript", "C#", "All of the above"],
  },
  {
    type: "longForm",
    questionText: "Describe the Model-View-Controller (MVC) architecture.",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which are the pillars of Object-Oriented Programming (OOP)?",
    options: ["Inheritance", "Polymorphism", "Encapsulation", "Iteration"],
    points: 5,
    correctOptions: ["Inheritance", "Polymorphism", "Encapsulation"],
  },
  {
    type: "longForm",
    questionText:
      "Discuss the significance of cybersecurity in today's digital age.",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which are front-end libraries/frameworks?",
    options: ["React", "Express.js", "Angular", "Vue.js"],
    points: 5,
    correctOptions: ["React", "Angular", "Vue.js"],
  },
  {
    type: "longForm",
    questionText: "What is API and why is it important?",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which are types of database systems?",
    options: ["Relational", "Document-based", "Graph-based", "URL-based"],
    points: 5,
    correctOptions: ["Relational", "Document-based", "Graph-based"],
  },
  {
    type: "longForm",
    questionText: "Discuss the principles of responsive web design.",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which are programming paradigms?",
    options: ["Functional", "Imperative", "Procedural", "Operative"],
    points: 5,
    correctOptions: ["Functional", "Imperative", "Procedural"],
  },
  {
    type: "longForm",
    questionText: "What is DevOps and why is it important?",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which of the following is NOT a version control system?",
    options: ["Git", "Mercurial", "Subversion", "PowerPoint"],
    points: 5,
    correctOptions: ["PowerPoint"],
  },
  {
    type: "longForm",
    questionText: "What is Big Data and how is it used in modern businesses?",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which of these are NOT JavaScript frameworks?",
    options: ["React", "Vue", "Django", "Angular"],
    points: 5,
    correctOptions: ["Django"],
  },
  {
    type: "longForm",
    questionText:
      "Explain the concept of Continuous Integration and Continuous Deployment (CI/CD).",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which of the following is a server-side scripting language?",
    options: ["CSS", "HTML", "PHP", "SVG"],
    points: 5,
    correctOptions: ["PHP"],
  },
  {
    type: "longForm",
    questionText:
      "Discuss the advantages and disadvantages of microservices architecture.",
    instructions: "Start writing your answer here.",
    points: 10,
  },
  {
    type: "multipleChoice",
    questionText: "Which are popular NoSQL databases?",
    options: ["MySQL", "MongoDB", "Cassandra", "DynamoDB"],
    points: 5,
    correctOptions: ["MongoDB", "Cassandra", "DynamoDB"],
  },
];
