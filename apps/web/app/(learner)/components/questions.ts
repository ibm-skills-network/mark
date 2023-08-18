export interface LongFormQuestionData {
  type: 'longForm';
  questionText: string;
  instructions: string;
  points: number;
}

export interface MultipleChoiceQuestionData {
  type: 'multipleChoice';
  questionText: string;
  options: string[];
  points: number;
  correctOptions: string[];
}

export type QuestionData = LongFormQuestionData | MultipleChoiceQuestionData;

export const questionsData: QuestionData[] = [
  {
    type: 'longForm',
    questionText: 'Describe the key elements of a project charter...',
    instructions: 'Start writing your answer here.',
    points: 10,
  },
  {
    type: 'multipleChoice',
    questionText: 'Choose the correct option.',
    options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
    points: 5,
    correctOptions: ['Option 1', 'Option 2'],
  },
  {
    type: 'multipleChoice',
    questionText: 'Which of the following is NOT a programming language?',
    options: ['Python', 'Java', 'HTML', 'C++'],
    points: 5,
    correctOptions: ['HTML'],
  },
  {
    type: 'multipleChoice',
    questionText: 'What is the capital of France?',
    options: ['Paris', 'London', 'Berlin', 'Madrid'],
    points: 5,
    correctOptions: ['Paris'],
  },
  {
    type: 'longForm',
    questionText: 'Explain the difference between classical and quantum computing.',
    instructions: 'Start writing your answer here.',
    points: 10,
  },
];
