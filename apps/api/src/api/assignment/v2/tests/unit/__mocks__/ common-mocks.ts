/* eslint-disable unicorn/no-array-push-push */
/* eslint-disable unicorn/no-null */
/* eslint-disable unicorn/no-useless-undefined */

import {
  Assignment,
  AssignmentAttempt,
  AssignmentFeedback,
  AssignmentQuestionDisplayOrder,
  AssignmentTranslation,
  AssignmentType,
  FeedbackTranslation,
  Job,
  Prisma,
  Question,
  QuestionDisplay,
  QuestionResponse,
  QuestionType,
  QuestionVariant,
  RegradingRequest,
  RegradingStatus,
  Report,
  ReportStatus,
  ReportType,
  ResponseType,
  Translation,
  VariantType,
} from "@prisma/client";
import { BaseAssignmentResponseDto } from "src/api/assignment/dto/base.assignment.response.dto";
import {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "src/api/assignment/dto/get.assignment.response.dto";
import { QuestionGenerationPayload } from "src/api/assignment/dto/post.assignment.request.dto";
import { ReplaceAssignmentRequestDto } from "src/api/assignment/dto/replace.assignment.request.dto";
import { UpdateAssignmentRequestDto } from "src/api/assignment/dto/update.assignment.request.dto";
import {
  Choice,
  QuestionDto,
  RubricDto,
  ScoringDto,
  UpdateAssignmentQuestionsDto,
  VariantDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { AssignmentTypeEnum } from "src/api/llm/features/question-generation/services/question-generation.service";
import {
  UserRole,
  UserSession,
} from "src/auth/interfaces/user.session.interface";

/**
 * Sample Choice objects for questions
 */
/**
 * Sample user sessions for different roles
 */
export const sampleAuthorSession: UserSession = {
  userId: "author-123",
  role: UserRole.AUTHOR,
  groupId: "group-123",
  assignmentId: 1,
  returnUrl: "https://example.com/return",
  launch_presentation_locale: "en",
};

export const sampleLearnerSession: UserSession = {
  userId: "learner-456",
  role: UserRole.LEARNER,
  groupId: "group-123",
  assignmentId: 1,
  returnUrl: "https://example.com/return",
  launch_presentation_locale: "en",
};

export const sampleScoringRubric: RubricDto = {
  rubricQuestion: "Did the response identify the correct capital?",
  criteria: [
    {
      id: 1,
      description: "Correctly identified Paris as the capital",
      points: 5,
    },
    {
      id: 2,
      description: "Explained why Paris is significant",
      points: 3,
    },
  ],
};

export const sampleScoring: ScoringDto = {
  type: ScoringType.CRITERIA_BASED,
  rubrics: [sampleScoringRubric],
  showRubricsToLearner: true,
};

export const sampleChoiceA: Choice = {
  id: 1,
  choice: "Paris",
  isCorrect: true,
  points: 1,
  feedback: "Correct!",
};

export const sampleChoiceB: Choice = {
  id: 2,
  choice: "London",
  isCorrect: false,
  points: 0,
  feedback: "Incorrect. Paris is the capital of France.",
};

export const sampleChoiceC: Choice = {
  id: 3,
  choice: "Berlin",
  isCorrect: false,
  points: 0,
  feedback: "That's the capital of Germany, not France.",
};

export const sampleMultipleChoiceA: Choice = {
  id: 1,
  choice: "Dolphin",
  isCorrect: true,
  points: 2,
  feedback: "Correct! Dolphins are mammals.",
};

export const sampleMultipleChoiceB: Choice = {
  id: 2,
  choice: "Shark",
  isCorrect: false,
  points: 0,
  feedback: "Incorrect. Sharks are fish, not mammals.",
};

export const sampleMultipleChoiceC: Choice = {
  id: 3,
  choice: "Bat",
  isCorrect: true,
  points: 2,
  feedback: "Correct! Bats are mammals.",
};

/**
 * Sample React-related question choices
 */
export const sampleReactChoices: {
  [key: string]: Choice[];
} = {
  singleCorrect: [
    {
      choice: "Use shouldComponentUpdate lifecycle method",
      id: 0,
      isCorrect: true,
      points: 5,
      feedback:
        "Correct! The shouldComponentUpdate method allows you to control whether a component should re-render.",
    },
    {
      choice: "Use componentDidMount lifecycle method",
      id: 1,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. componentDidMount is used for operations that need to happen after the component is inserted into the DOM.",
    },
    {
      choice: "Use componentWillUnmount lifecycle method",
      id: 2,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. componentWillUnmount is used for cleanup before a component is removed from the DOM.",
    },
    {
      choice: "Use setState method frequently",
      id: 3,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. Frequent use of setState can cause unnecessary re-renders, not prevent them.",
    },
  ],

  multipleCorrect: [
    {
      choice: "componentDidMount is called after the component is rendered.",
      id: 0,
      isCorrect: true,
      points: 2,
      feedback:
        "Correct! componentDidMount is invoked immediately after a component is added to the DOM.",
    },
    {
      choice: "componentWillUnmount is used for setting initial state.",
      id: 1,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. componentWillUnmount is used for cleanup before a component is removed from the DOM.",
    },
    {
      choice: "shouldComponentUpdate is used to optimize performance.",
      id: 2,
      isCorrect: true,
      points: 2,
      feedback:
        "Correct! shouldComponentUpdate allows you to prevent unnecessary re-renders of a component.",
    },
    {
      choice: "componentDidUpdate is called before rendering.",
      id: 3,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. componentDidUpdate is called after a component's updates are flushed to the DOM.",
    },
  ],

  virtualDom: [
    {
      choice: "Virtual DOM",
      id: 0,
      isCorrect: true,
      points: 5,
      feedback:
        "Correct! The Virtual DOM allows React to minimize direct manipulation of the DOM, enhancing performance.",
    },
    {
      choice: "Two-way data binding",
      id: 1,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. React uses one-way data binding, which is different from two-way data binding found in some other frameworks.",
    },
    {
      choice: "Server-side rendering",
      id: 2,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. While server-side rendering can improve performance, it is not a core feature of React itself.",
    },
    {
      choice: "Global state management",
      id: 3,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. Global state management is typically handled by libraries like Redux, not React itself.",
    },
  ],

  reactHooks: [
    {
      choice: "Hooks allow functional components to have state.",
      id: 0,
      isCorrect: true,
      points: 2,
      feedback:
        "Correct! Hooks like useState enable state management in functional components.",
    },
    {
      choice: "Hooks replace the need for lifecycle methods.",
      id: 1,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. Hooks provide an alternative to lifecycle methods, but do not replace them entirely.",
    },
    {
      choice: "Hooks enable reuse of stateful logic.",
      id: 2,
      isCorrect: true,
      points: 2,
      feedback:
        "Correct! Custom hooks allow you to extract and reuse stateful logic across components.",
    },
    {
      choice: "Hooks enforce two-way data binding.",
      id: 3,
      isCorrect: false,
      points: 0,
      feedback:
        "Incorrect. Hooks do not enforce two-way data binding; React uses one-way data flow.",
    },
  ],
};

/**
 * Sample rubrics for evaluating React-related text responses
 */
export const sampleReactRubrics: {
  [key: string]: ScoringDto;
} = {
  propsVsState: {
    type: ScoringType.CRITERIA_BASED,
    rubrics: [
      {
        rubricQuestion: "How accurately does the response describe 'props'?",
        criteria: [
          {
            description:
              "Provides a comprehensive and accurate description of 'props'.",
            points: 4,
          },
          {
            description: "Provides an accurate description but lacks detail.",
            points: 3,
          },
          {
            description:
              "Provides a partially accurate description with some errors.",
            points: 2,
          },
          {
            description: "Provides an inaccurate or incomplete description.",
            points: 1,
          },
        ],
      },
      {
        rubricQuestion:
          "How well does the response differentiate 'props' from 'state'?",
        criteria: [
          {
            description:
              "Thoroughly explains the differences between 'props' and 'state'.",
            points: 4,
          },
          {
            description: "Explains differences with some detail.",
            points: 3,
          },
          {
            description: "Mentions differences but lacks detail.",
            points: 2,
          },
          {
            description:
              "Fails to accurately differentiate 'props' from 'state'.",
            points: 1,
          },
        ],
      },
      {
        rubricQuestion: "How well-organized is the response?",
        criteria: [
          {
            description: "Response is well-organized and logically structured.",
            points: 4,
          },
          {
            description: "Response is organized but with minor logical issues.",
            points: 3,
          },
          {
            description:
              "Response has organizational issues affecting clarity.",
            points: 2,
          },
          {
            description:
              "Response is poorly organized and difficult to follow.",
            points: 1,
          },
        ],
      },
    ],
  },

  virtualDom: {
    type: ScoringType.CRITERIA_BASED,
    rubrics: [
      {
        rubricQuestion:
          "How accurately does the response describe the Virtual DOM?",
        criteria: [
          {
            description:
              "Provides a comprehensive and accurate description of the Virtual DOM.",
            points: 4,
          },
          {
            description: "Provides an accurate description but lacks detail.",
            points: 3,
          },
          {
            description:
              "Provides a partially accurate description with some errors.",
            points: 2,
          },
          {
            description: "Provides an inaccurate or incomplete description.",
            points: 1,
          },
        ],
      },
      {
        rubricQuestion:
          "How well does the response explain the performance benefits?",
        criteria: [
          {
            description:
              "Thoroughly explains how the Virtual DOM improves performance.",
            points: 4,
          },
          {
            description: "Explains performance benefits with some detail.",
            points: 3,
          },
          {
            description: "Mentions performance benefits but lacks detail.",
            points: 2,
          },
          {
            description: "Fails to accurately explain performance benefits.",
            points: 1,
          },
        ],
      },
      {
        rubricQuestion: "How well-organized is the response?",
        criteria: [
          {
            description: "Response is well-organized and logically structured.",
            points: 4,
          },
          {
            description: "Response is organized but with minor logical issues.",
            points: 3,
          },
          {
            description:
              "Response has organizational issues affecting clarity.",
            points: 2,
          },
          {
            description:
              "Response is poorly organized and difficult to follow.",
            points: 1,
          },
        ],
      },
    ],
  },

  codeSubmission: {
    type: ScoringType.CRITERIA_BASED,
    rubrics: [
      {
        rubricQuestion: "How well does the code demonstrate React concepts?",
        criteria: [
          {
            description:
              "Code demonstrates React concepts clearly and accurately.",
            points: 4,
          },
          {
            description: "Code demonstrates most React concepts accurately.",
            points: 3,
          },
          {
            description: "Code demonstrates some React concepts accurately.",
            points: 2,
          },
          {
            description: "Code fails to demonstrate React concepts accurately.",
            points: 1,
          },
        ],
      },
      {
        rubricQuestion: "How clear and informative are the comments?",
        criteria: [
          {
            description:
              "Comments are clear and provide detailed explanations.",
            points: 4,
          },
          {
            description: "Comments are mostly clear and informative.",
            points: 3,
          },
          {
            description: "Comments are unclear or lack detail.",
            points: 2,
          },
          {
            description: "Comments are missing or uninformative.",
            points: 1,
          },
        ],
      },
    ],
  },
};

/**
 * Sample variants for React-focused questions
 */
export const sampleReactVariants = {
  componentLifecycle: [
    {
      id: 1,
      questionId: 1,
      variantContent:
        "In a React project, what method can be used to prevent components from re-rendering unnecessarily?",
      choices: [
        {
          choice: "Implement the shouldComponentUpdate method",
          points: 5,
          feedback:
            "Correct! shouldComponentUpdate is used to determine whether a component should re-render.",
          isCorrect: true,
          id: 0,
        },
        {
          choice: "Use the componentDidUpdate lifecycle method",
          points: 0,
          feedback:
            "Incorrect. componentDidUpdate is used for actions after a component updates, not for controlling re-renders.",
          isCorrect: false,
          id: 1,
        },
        {
          choice: "Utilize the componentWillReceiveProps lifecycle method",
          points: 0,
          feedback:
            "Incorrect. componentWillReceiveProps is used to update state based on props, not for controlling re-renders.",
          isCorrect: false,
          id: 2,
        },
        {
          choice: "Invoke setState with updated values",
          points: 0,
          feedback:
            "Incorrect. Using setState can trigger re-renders, not prevent them.",
          isCorrect: false,
          id: 3,
        },
      ],
      createdAt: "2025-04-30T22:47:52.581Z",
      variantType: VariantType.REWORDED,
      randomizedChoices: true,
    },
  ],

  virtualDom: [
    {
      id: 2,
      questionId: 3,
      variantContent:
        "What is a primary feature of React that improves its efficiency?",
      choices: [
        {
          choice: "Virtual DOM",
          points: 5,
          feedback:
            "Correct! The Virtual DOM optimizes React by reducing direct updates to the actual DOM, thus boosting efficiency.",
          isCorrect: true,
          id: 0,
        },
        {
          choice: "Bidirectional data flow",
          points: 0,
          feedback:
            "Incorrect. React uses unidirectional data flow, not bidirectional, which is typical of other frameworks.",
          isCorrect: false,
          id: 1,
        },
        {
          choice: "Client-side rendering",
          points: 0,
          feedback:
            "Incorrect. Client-side rendering is a common practice but not a specific feature of React that enhances efficiency.",
          isCorrect: false,
          id: 2,
        },
        {
          choice: "State management with Context API",
          points: 0,
          feedback:
            "Incorrect. While the Context API helps with state management, it is not a performance feature of React itself.",
          isCorrect: false,
          id: 3,
        },
      ],
      createdAt: "2025-04-30T22:47:53.159Z",
      variantType: VariantType.REWORDED,
      randomizedChoices: true,
    },
  ],
};

/**
 * Used for creating JSON value in Prisma format
 */
const toJsonValue = (value: unknown): Prisma.JsonValue => {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value) as Prisma.JsonValue;
};

/**
 * Create a sample Question object with sane defaults
 */
export const createMockQuestion = (
  overrides: Partial<Question> = {},
  questionType: QuestionType = QuestionType.SINGLE_CORRECT,
): Question => {
  const baseQuestion: Question = {
    id: 1,
    totalPoints: 10,
    type: questionType,
    responseType: ResponseType.OTHER,
    question: "What is the capital of France?",
    maxWords: null,
    scoring: null,
    choices: toJsonValue([sampleChoiceA, sampleChoiceB, sampleChoiceC]),
    randomizedChoices: false,
    answer: null,
    assignmentId: 1,
    gradingContextQuestionIds: [],
    maxCharacters: null,
    isDeleted: false,
    videoPresentationConfig: null,
    liveRecordingConfig: null,
  };

  switch (questionType) {
    case QuestionType.MULTIPLE_CORRECT: {
      baseQuestion.question = "Which of these animals are mammals?";
      baseQuestion.choices = toJsonValue([
        sampleMultipleChoiceA,
        sampleMultipleChoiceB,
        sampleMultipleChoiceC,
      ]);

      break;
    }
    case QuestionType.TEXT: {
      baseQuestion.question =
        "Explain why Paris is significant as the capital of France.";
      baseQuestion.choices = null;
      baseQuestion.maxWords = 500;
      baseQuestion.scoring = toJsonValue(sampleScoring);

      break;
    }
    case QuestionType.TRUE_FALSE: {
      baseQuestion.question = "Paris is the capital of France.";
      baseQuestion.choices = null;
      baseQuestion.answer = true;

      break;
    }
  }

  return {
    ...baseQuestion,
    ...overrides,
  };
};

/**
 * Create a sample QuestionDto object with sane defaults
 */
export const createMockQuestionDto = (
  overrides: Partial<QuestionDto> = {},
  questionType: QuestionType = QuestionType.SINGLE_CORRECT,
): QuestionDto => {
  const baseQuestionDto: QuestionDto = {
    id: 1,
    totalPoints: 10,
    type: questionType,
    responseType: ResponseType.OTHER,
    question: "What is the capital of France?",
    maxWords: null,
    scoring: null,
    choices: [sampleChoiceA, sampleChoiceB, sampleChoiceC],
    randomizedChoices: false,
    answer: null,
    assignmentId: 1,
    gradingContextQuestionIds: [],
    maxCharacters: null,
    isDeleted: false,
    variants: [],
    alreadyInBackend: true,
  };

  switch (questionType) {
    case QuestionType.MULTIPLE_CORRECT: {
      baseQuestionDto.question = "Which of these animals are mammals?";
      baseQuestionDto.choices = [
        sampleMultipleChoiceA,
        sampleMultipleChoiceB,
        sampleMultipleChoiceC,
      ];

      break;
    }
    case QuestionType.TEXT: {
      baseQuestionDto.question =
        "Explain why Paris is significant as the capital of France.";
      baseQuestionDto.choices = undefined;
      baseQuestionDto.maxWords = 500;
      baseQuestionDto.scoring = sampleScoring;

      break;
    }
    case QuestionType.TRUE_FALSE: {
      baseQuestionDto.question = "Paris is the capital of France.";
      baseQuestionDto.choices = undefined;
      baseQuestionDto.answer = true;

      break;
    }
  }

  return {
    ...baseQuestionDto,
    ...overrides,
  };
};

/**
 * Create a sample QuestionVariant object
 */
export const createMockQuestionVariant = (
  overrides: Partial<QuestionVariant> = {},
  questionId = 1,
  variantType: VariantType = VariantType.REWORDED,
): QuestionVariant => {
  const baseVariant: QuestionVariant = {
    id: 101,
    questionId,
    variantContent: "What city serves as the capital of France?",
    choices: toJsonValue([sampleChoiceA, sampleChoiceB, sampleChoiceC]),
    maxWords: null,
    scoring: null,
    answer: null,
    maxCharacters: null,
    createdAt: new Date(),
    difficultyLevel: null,
    variantType: variantType,
    randomizedChoices: false,
    isDeleted: false,
  };

  return {
    ...baseVariant,
    ...overrides,
  };
};

/**
 * Create a sample VariantDto object
 */
export const createMockVariantDto = (
  overrides: Partial<VariantDto> = {},
  _questionId = 1,
  variantType: VariantType = VariantType.REWORDED,
): VariantDto => {
  const baseVariantDto: VariantDto = {
    id: 101,
    variantContent: "What city serves as the capital of France?",
    choices: [sampleChoiceA, sampleChoiceB, sampleChoiceC],
    maxWords: null,
    scoring: null,
    maxCharacters: null,
    variantType:
      variantType as unknown as import("src/api/assignment/dto/update.questions.request.dto").VariantType,
    randomizedChoices: false,
    isDeleted: false,
  };

  return {
    ...baseVariantDto,
    ...overrides,
  };
};

/**
 * Create a React-focused question with appropriate content based on type
 */
export const createReactQuestionDto = (
  type: QuestionType,
  id: number = Math.floor(Math.random() * 1_000_000_000),
  overrides: Partial<QuestionDto> = {},
): QuestionDto => {
  const baseQuestion: Partial<QuestionDto> = {
    id,
    assignmentId: 1,
    alreadyInBackend: true,
    isDeleted: false,
    totalPoints: 0,
    gradingContextQuestionIds: [],
    variants: [],
  };

  let questionSpecific: Partial<QuestionDto> = {};

  switch (type) {
    case QuestionType.SINGLE_CORRECT: {
      questionSpecific = {
        question:
          "When developing a React application, how can you ensure that components only re-render when necessary?",
        totalPoints: 5,
        type: QuestionType.SINGLE_CORRECT,
        responseType: ResponseType.OTHER,
        randomizedChoices: true,
        choices: sampleReactChoices.singleCorrect,
        variants: [
          createMockVariantDto({
            id: id * 10 + 1,
            variantContent:
              "In a React project, what method can be used to prevent components from re-rendering unnecessarily?",
            choices: sampleReactVariants.componentLifecycle[0].choices,
          }),
        ],
      };
      break;
    }

    case QuestionType.MULTIPLE_CORRECT: {
      questionSpecific = {
        question:
          "Select all correct statements about React's component lifecycle.",
        totalPoints: 4,
        type: QuestionType.MULTIPLE_CORRECT,
        responseType: ResponseType.OTHER,
        randomizedChoices: true,
        choices: sampleReactChoices.multipleCorrect,
      };
      break;
    }

    case QuestionType.TEXT: {
      questionSpecific = {
        question:
          "Describe the concept of 'props' in React and how they differ from 'state'.",
        totalPoints: 12,
        type: QuestionType.TEXT,
        responseType: ResponseType.ESSAY,
        maxWords: 200,
        maxCharacters: 1200,
        scoring: sampleReactRubrics.propsVsState,
        choices: undefined,
      };
      break;
    }

    case QuestionType.TRUE_FALSE: {
      questionSpecific = {
        question:
          "React's useState hook allows you to manage state in functional components.",
        totalPoints: 4,
        type: QuestionType.TRUE_FALSE,
        responseType: ResponseType.OTHER,
        choices: [
          {
            id: 0,
            choice: "true",
            isCorrect: true,
            points: 4,
            feedback:
              "Correct! The useState hook is a fundamental part of React's Hooks API, enabling state management in functional components.",
          },
        ],
      };
      break;
    }

    case QuestionType.URL: {
      questionSpecific = {
        question:
          "Submit a URL to a GitHub repository containing a React application that demonstrates the use of hooks.",
        totalPoints: 8,
        type: QuestionType.URL,
        responseType: ResponseType.REPORT,
        scoring: sampleReactRubrics.codeSubmission,
        choices: undefined,
      };
      break;
    }

    case QuestionType.UPLOAD: {
      questionSpecific = {
        question:
          "Upload a file containing a React component with comments explaining each part of the code.",
        totalPoints: 8,
        type: QuestionType.UPLOAD,
        responseType: ResponseType.CODE,
        scoring: sampleReactRubrics.codeSubmission,
        choices: undefined,
      };
      break;
    }

    case QuestionType.LINK_FILE: {
      questionSpecific = {
        question:
          "Provide a link to a file containing a React component that implements error boundaries.",
        totalPoints: 8,
        type: QuestionType.LINK_FILE,
        responseType: ResponseType.CODE,
        scoring: sampleReactRubrics.codeSubmission,
        choices: undefined,
      };
      break;
    }

    default: {
      questionSpecific = {
        question: "Default React question",
        totalPoints: 5,
        type: QuestionType.SINGLE_CORRECT,
        responseType: ResponseType.OTHER,
        choices: sampleReactChoices.singleCorrect,
      };
    }
  }

  return {
    ...baseQuestion,
    ...questionSpecific,
    ...overrides,
    isDeleted: overrides.isDeleted ?? questionSpecific.isDeleted ?? false,
  } as QuestionDto;
};

/**
 * Returns a plain `Assignment` object with sane defaults.
 * Pass a partial object to override only the fields you care about.
 */
export const createMockAssignment = (
  overrides: Partial<Assignment> = {},
): Assignment => ({
  id: 1,
  name: "Sample Assignment",
  introduction: "Intro text",
  instructions: "Do the work",
  gradingCriteriaOverview: "Each question = 1pt",
  timeEstimateMinutes: 30,
  type: AssignmentType.AI_GRADED,
  graded: false,
  numAttempts: -1,
  attemptsBeforeCoolDown: 1,
  retakeAttemptCoolDownMinutes: 5,
  allotedTimeMinutes: null,
  attemptsPerTimeRange: null,
  attemptsTimeRangeHours: null,
  numberOfQuestionsPerAttempt: undefined,
  passingGrade: 50,
  displayOrder: AssignmentQuestionDisplayOrder.DEFINED,
  questionDisplay: QuestionDisplay.ONE_PER_PAGE,
  questionOrder: [1, 2],
  published: false,
  showAssignmentScore: true,
  showCorrectAnswer: true,
  showQuestionScore: true,
  showSubmissionFeedback: true,
  showQuestions: true,
  updatedAt: new Date(),
  languageCode: "en",
  currentVersionId: 1,
  ...overrides,
});

/**
 * Create a sample GetAssignmentResponseDto with sane defaults
 */
export const createMockGetAssignmentResponseDto = (
  overrides: Partial<GetAssignmentResponseDto> = {},
  questions: Question[] = [
    createMockQuestion(),
    createMockQuestion({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
  ],
): GetAssignmentResponseDto => {
  const assignment = createMockAssignment();

  return {
    ...assignment,
    questions,
    success: true,
    ...overrides,
  };
};

/**
 * Create a sample LearnerGetAssignmentResponseDto with sane defaults
 */
export const createMockLearnerGetAssignmentResponseDto = (
  overrides: Partial<LearnerGetAssignmentResponseDto> = {},
): LearnerGetAssignmentResponseDto => {
  const assignment = createMockAssignment();

  return {
    ...assignment,
    questions: [] as Question[],
    success: true,
    ...overrides,
  };
};

/**
 * Create a sample AssignmentResponseDto with sane defaults
 */
export const createMockAssignmentResponseDto = (
  overrides: Partial<AssignmentResponseDto> = {},
): AssignmentResponseDto => {
  const assignment = createMockAssignment();

  return {
    ...assignment,
    ...overrides,
  };
};

/**
 * Create a sample BaseAssignmentResponseDto with sane defaults
 */
export const createMockBaseAssignmentResponseDto = (
  overrides: Partial<BaseAssignmentResponseDto> = {},
): BaseAssignmentResponseDto => {
  return {
    id: 1,
    success: true,
    ...overrides,
  };
};

/**
 * Handy when you want to test update/patch flows.
 * Generates an `UpdateAssignmentRequestDto` with defaults,
 * but you can override any subset of properties.
 */
export const createMockUpdateAssignmentDto = (
  overrides: Partial<UpdateAssignmentRequestDto> = {},
): UpdateAssignmentRequestDto => ({
  name: "Updated Assignment",
  introduction: "New intro",
  instructions: "Follow the new instructions",
  gradingCriteriaOverview: "Updated rubric",
  timeEstimateMinutes: 45,
  graded: true,
  numAttempts: 3,
  attemptsBeforeCoolDown: 1,
  retakeAttemptCoolDownMinutes: 5,
  allotedTimeMinutes: 60,
  attemptsPerTimeRange: null,
  attemptsTimeRangeHours: null,
  passingGrade: 60,
  displayOrder: AssignmentQuestionDisplayOrder.RANDOM,
  questionDisplay: QuestionDisplay.ONE_PER_PAGE,
  published: true,
  questionOrder: [1, 2],
  numberOfQuestionsPerAttempt: undefined,
  showAssignmentScore: true,
  showQuestionScore: true,
  showSubmissionFeedback: true,
  showQuestions: true,
  showCorrectAnswer: true,
  ...overrides,
});

/**
 * Create a sample ReplaceAssignmentRequestDto with sane defaults
 */
export const createMockReplaceAssignmentDto = (
  overrides: Partial<ReplaceAssignmentRequestDto> = {},
): ReplaceAssignmentRequestDto => ({
  introduction: "Completely new introduction",
  instructions: "Completely new instructions",
  gradingCriteriaOverview: "New grading criteria",
  timeEstimateMinutes: 60,
  graded: true,
  numAttempts: 2,
  attemptsBeforeCoolDown: 1,
  retakeAttemptCoolDownMinutes: 5,
  allotedTimeMinutes: 90,
  attemptsPerTimeRange: null,
  attemptsTimeRangeHours: null,
  passingGrade: 70,
  displayOrder: AssignmentQuestionDisplayOrder.DEFINED,
  published: true,
  questionOrder: [1, 2],
  ...overrides,
});

/**
 * Create a sample UpdateAssignmentQuestionsDto with sane defaults
 */
export const createMockUpdateAssignmentQuestionsDto = (
  overrides: Partial<UpdateAssignmentQuestionsDto> = {},
  includeQuestions = true,
): UpdateAssignmentQuestionsDto => {
  const baseDto: UpdateAssignmentQuestionsDto = {
    name: "Updated Assignment with Questions",
    introduction: "Introduction with updated questions",
    instructions: "Instructions for updated questions",
    gradingCriteriaOverview: "Updated grading criteria",
    timeEstimateMinutes: 45,
    graded: true,
    numAttempts: 3,
    attemptsBeforeCoolDown: 1,
    retakeAttemptCoolDownMinutes: 5,
    allotedTimeMinutes: 60,
    attemptsPerTimeRange: null,
    attemptsTimeRangeHours: null,
    passingGrade: 60,
    displayOrder: AssignmentQuestionDisplayOrder.DEFINED,
    questionDisplay: QuestionDisplay.ONE_PER_PAGE,
    numberOfQuestionsPerAttempt: undefined,
    published: true,
    questionOrder: [1, 2],
    showAssignmentScore: true,
    showQuestionScore: true,
    showSubmissionFeedback: true,
    showQuestions: true,
    showCorrectAnswer: true,
    versionNumber: "0.0.1",
    versionDescription: "Updated questions version",
    updatedAt: new Date(),
    questions: includeQuestions
      ? [
          createMockQuestionDto(),
          createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
        ]
      : [],
  };

  return {
    ...baseDto,
    ...overrides,
  };
};

/**
 * Create a sample AssignmentAttempt with sane defaults
 */
export const createMockAssignmentAttempt = (
  overrides: Partial<AssignmentAttempt> = {},
  isCompleted = false,
): AssignmentAttempt => {
  const baseAttempt: AssignmentAttempt = {
    id: 1,
    assignmentId: 1,
    userId: "learner-456",
    submitted: isCompleted,
    grade: isCompleted ? 80 : null,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
    questionOrder: [1, 2],
    comments: null,
    preferredLanguage: "en",
    assignmentVersionId: 1,
  };

  return {
    ...baseAttempt,
    ...overrides,
  };
};

/**
 * Create a sample QuestionResponse with sane defaults
 */
export const createMockQuestionResponse = (
  overrides: Partial<QuestionResponse> = {},
  questionId = 1,
  isGraded = true,
): QuestionResponse => {
  const baseResponse: QuestionResponse = {
    id: 1,
    assignmentAttemptId: 1,
    questionId,
    learnerResponse:
      questionId === 1
        ? JSON.stringify({ learnerChoices: ["Paris"] })
        : JSON.stringify({
            learnerTextResponse:
              "Mammals are warm-blooded animals that feed their young with milk.",
          }),
    points: isGraded ? 10 : null,
    feedback: isGraded ? JSON.stringify([{ feedback: "Good job!" }]) : null,
    metadata: null,
    gradedAt: isGraded ? new Date() : null,
  };

  return {
    ...baseResponse,
    ...overrides,
  };
};

/**
 * Create a sample Job with sane defaults
 */
export const createMockJob = (
  overrides: Partial<Job> = {},
  status = "Pending",
): Job => {
  const baseJob: Job = {
    id: 1,
    userId: "author-123",
    assignmentId: 1,
    status,
    progress: (() => {
      if (status === "Pending") return "Job created";
      if (status === "In Progress") return "Processing";
      if (status === "Completed") return "Job completed successfully";
      return "Job failed";
    })(),
    createdAt: new Date(),
    updatedAt: new Date(),
    result:
      status === "Completed" ? JSON.stringify([createMockQuestionDto()]) : null,
  };

  return {
    ...baseJob,
    ...overrides,
  };
};

/**
 * Create a sample Translation with sane defaults
 */
export const createMockTranslation = (
  overrides: Partial<Translation> = {},
  languageCode = "fr",
): Translation => {
  const baseTranslation: Translation = {
    id: 1,
    questionId: 1,
    variantId: null,
    languageCode,
    translatedText:
      languageCode === "fr"
        ? "Quelle est la capitale de la France?"
        : languageCode === "es"
          ? "¿Cuál es la capital de Francia?"
          : "What is the capital of France?",
    untranslatedText: "What is the capital of France?",
    translatedChoices: JSON.stringify([
      {
        ...sampleChoiceA,
        choice:
          languageCode === "fr"
            ? "Paris"
            : languageCode === "es"
              ? "París"
              : "Paris",
      },
      {
        ...sampleChoiceB,
        choice:
          languageCode === "fr"
            ? "Londres"
            : languageCode === "es"
              ? "Londres"
              : "London",
      },
      {
        ...sampleChoiceC,
        choice:
          languageCode === "fr"
            ? "Berlin"
            : languageCode === "es"
              ? "Berlín"
              : "Berlin",
      },
    ]),
    untranslatedChoices: JSON.stringify([
      sampleChoiceA,
      sampleChoiceB,
      sampleChoiceC,
    ]),
    createdAt: new Date(),
  };

  return {
    ...baseTranslation,
    ...overrides,
  };
};

/**
 * Create a sample AssignmentTranslation with sane defaults
 */
export const createMockAssignmentTranslation = (
  overrides: Partial<AssignmentTranslation> = {},
  languageCode = "fr",
): AssignmentTranslation => {
  const baseAssignmentTranslation: AssignmentTranslation = {
    id: 1,
    assignmentId: 1,
    languageCode,
    name: "Sample Assignment",
    introduction: "Intro text",
    instructions: "Do the work",
    gradingCriteriaOverview: "Each question = 1pt",
    translatedName:
      languageCode === "fr"
        ? "Exemple de devoir"
        : languageCode === "es"
          ? "Ejemplo de tarea"
          : "Sample Assignment",
    translatedIntroduction:
      languageCode === "fr"
        ? "Texte d'introduction"
        : languageCode === "es"
          ? "Texto introductorio"
          : "Intro text",
    translatedInstructions:
      languageCode === "fr"
        ? "Faites le travail"
        : languageCode === "es"
          ? "Haz el trabajo"
          : "Do the work",
    translatedGradingCriteriaOverview:
      languageCode === "fr"
        ? "Chaque question = 1pt"
        : languageCode === "es"
          ? "Cada pregunta = 1pt"
          : "Each question = 1pt",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    ...baseAssignmentTranslation,
    ...overrides,
  };
};

/**
 * Create a sample FeedbackTranslation with sane defaults
 */
export const createMockFeedbackTranslation = (
  overrides: Partial<FeedbackTranslation> = {},
  languageCode = "fr",
): FeedbackTranslation => {
  const baseFeedbackTranslation: FeedbackTranslation = {
    id: 1,
    questionId: 1,
    languageCode,
    untranslatedFeedback: JSON.stringify({
      "1": "Correct!",
      "2": "Incorrect. Paris is the capital of France.",
      "3": "That's the capital of Germany, not France.",
    }),
    translatedFeedback:
      languageCode === "fr"
        ? JSON.stringify({
            "1": "Correct!",
            "2": "Incorrect. Paris est la capitale de la France.",
            "3": "C'est la capitale de l'Allemagne, pas de la France.",
          })
        : languageCode === "es"
          ? JSON.stringify({
              "1": "¡Correcto!",
              "2": "Incorrecto. París es la capital de Francia.",
              "3": "Esa es la capital de Alemania, no de Francia.",
            })
          : JSON.stringify({
              "1": "Correct!",
              "2": "Incorrect. Paris is the capital of France.",
              "3": "That's the capital of Germany, not France.",
            }),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    ...baseFeedbackTranslation,
    ...overrides,
  };
};

/**
 * Create a sample Report with sane defaults
 */
export const createMockReport = (
  overrides: Partial<Report> = {},
  issueType: ReportType = ReportType.BUG,
): Report => {
  const baseReport: Report = {
    id: 1,
    reporterId: "learner-456",
    assignmentId: 1,
    attemptId: 1,
    issueType,
    description: "I found an issue with this assignment",
    author: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    status: "OPEN" as ReportStatus,
    issueNumber: 1,
    statusMessage: "Report is open",
    resolution: "",
    comments: "",
    duplicateOfReportId: null,
    relatedToReportId: null,
    similarityScore: 0,
    closureReason: null,
  };

  return {
    ...baseReport,
    ...overrides,
  };
};

/**
 * Create a sample AssignmentFeedback with sane defaults
 */
export const createMockAssignmentFeedback = (
  overrides: Partial<AssignmentFeedback> = {},
): AssignmentFeedback => {
  const baseFeedback: AssignmentFeedback = {
    id: 1,
    assignmentId: 1,
    attemptId: 1,
    userId: "learner-456",
    comments: "This assignment was well-structured",
    aiGradingRating: 4,
    assignmentRating: 5,
    aiFeedbackRating: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    email: "learner-456@example.com",
    firstName: "John",
    lastName: "Doe",
    allowContact: true,
  };

  return {
    ...baseFeedback,
    ...overrides,
  };
};

/**
 * Create a sample RegradingRequest with sane defaults
 */
export const createMockRegradingRequest = (
  overrides: Partial<RegradingRequest> = {},
  status: RegradingStatus = RegradingStatus.PENDING,
): RegradingRequest => {
  const baseRequest: RegradingRequest = {
    id: 1,
    assignmentId: 1,
    userId: "learner-456",
    attemptId: 1,
    regradingReason: "I believe my answer for question 1 was correct",
    regradingStatus: status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    ...baseRequest,
    ...overrides,
  };
};

/**
 * Create a sample QuestionGenerationPayload with sane defaults
 */
export const createMockQuestionGenerationPayload = (
  overrides: Partial<QuestionGenerationPayload> = {},
): QuestionGenerationPayload => {
  const basePayload: QuestionGenerationPayload = {
    assignmentId: 1,
    assignmentType: AssignmentTypeEnum.ASSESSMENT,
    questionsToGenerate: {
      multipleChoice: 3,
      multipleSelect: 2,
      textResponse: 1,
      trueFalse: 2,
      url: 0,
      upload: 0,
      linkFile: 0,
      responseTypes: {
        TEXT: [ResponseType.ESSAY],
      },
    },
    fileContents: [
      {
        filename: "sample.txt",
        content: "This is sample content for question generation.",
      },
    ],
    learningObjectives:
      "Students should understand the basics of geography and be able to identify capitals of major countries.",
  };

  return {
    ...basePayload,
    ...overrides,
  };
};

/**
 * Create a mock logger
 */
export const createMockLogger = () => ({
  child: jest.fn().mockReturnThis(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
});

/**
 * Create a mock PrismaService with all repositories pre-mocked
 */
export const createMockPrismaService = () => ({
  assignment: {
    findUnique: jest.fn().mockResolvedValue(createMockAssignment()),
    findMany: jest.fn().mockResolvedValue([createMockAssignment()]),
    create: jest.fn().mockResolvedValue(createMockAssignment()),
    update: jest.fn().mockResolvedValue(createMockAssignment()),
    delete: jest.fn().mockResolvedValue(createMockAssignment()),
  },
  question: {
    findUnique: jest.fn().mockResolvedValue(createMockQuestionDto()),
    findMany: jest.fn().mockResolvedValue([createMockQuestionDto()]),
    create: jest.fn().mockResolvedValue(createMockQuestionDto()),
    update: jest.fn().mockResolvedValue(createMockQuestionDto()),
    upsert: jest.fn().mockResolvedValue(createMockQuestionDto()),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  questionVariant: {
    findUnique: jest.fn().mockResolvedValue(createMockQuestionVariant()),
    findMany: jest.fn().mockResolvedValue([createMockQuestionVariant()]),
    create: jest.fn().mockResolvedValue(createMockQuestionVariant()),
    update: jest.fn().mockResolvedValue(createMockQuestionVariant()),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  assignmentAttempt: {
    findUnique: jest.fn().mockResolvedValue(createMockAssignmentAttempt()),
    findMany: jest.fn().mockResolvedValue([createMockAssignmentAttempt()]),
    create: jest.fn().mockResolvedValue(createMockAssignmentAttempt()),
    update: jest.fn().mockResolvedValue(createMockAssignmentAttempt()),
  },
  questionResponse: {
    findUnique: jest.fn().mockResolvedValue(createMockQuestionResponse()),
    findMany: jest.fn().mockResolvedValue([createMockQuestionResponse()]),
    create: jest.fn().mockResolvedValue(createMockQuestionResponse()),
    update: jest.fn().mockResolvedValue(createMockQuestionResponse()),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  assignmentGroup: {
    findMany: jest
      .fn()
      .mockResolvedValue([{ groupId: "group-123", assignmentId: 1 }]),
  },
  job: {
    findUnique: jest.fn().mockResolvedValue(createMockJob()),
    create: jest.fn().mockResolvedValue(createMockJob()),
    update: jest.fn().mockResolvedValue(createMockJob()),
  },
  publishJob: {
    findUnique: jest.fn().mockResolvedValue(createMockJob()),
    create: jest.fn().mockResolvedValue(createMockJob()),
    update: jest.fn().mockResolvedValue(createMockJob()),
  },
  translation: {
    findUnique: jest.fn().mockResolvedValue(createMockTranslation()),
    findFirst: jest.fn().mockResolvedValue(createMockTranslation()),
    findMany: jest.fn().mockResolvedValue([createMockTranslation()]),
    create: jest.fn().mockResolvedValue(createMockTranslation()),
  },
  assignmentTranslation: {
    findUnique: jest.fn().mockResolvedValue(createMockAssignmentTranslation()),
    findFirst: jest.fn().mockResolvedValue(createMockAssignmentTranslation()),
    findMany: jest.fn().mockResolvedValue([createMockAssignmentTranslation()]),
    create: jest.fn().mockResolvedValue(createMockAssignmentTranslation()),
    update: jest.fn().mockResolvedValue(createMockAssignmentTranslation()),
    count: jest.fn().mockResolvedValue(1),
  },
  assignmentFeedback: {
    findUnique: jest.fn().mockResolvedValue(createMockAssignmentFeedback()),
    findMany: jest.fn().mockResolvedValue([createMockAssignmentFeedback()]),
    create: jest.fn().mockResolvedValue(createMockAssignmentFeedback()),
    update: jest.fn().mockResolvedValue(createMockAssignmentFeedback()),
  },
  regradingRequest: {
    findUnique: jest.fn().mockResolvedValue(createMockRegradingRequest()),
    findMany: jest.fn().mockResolvedValue([createMockRegradingRequest()]),
    create: jest.fn().mockResolvedValue(createMockRegradingRequest()),
    update: jest.fn().mockResolvedValue(createMockRegradingRequest()),
  },
  report: {
    findUnique: jest.fn().mockResolvedValue(createMockReport()),
    findMany: jest.fn().mockResolvedValue([createMockReport()]),
    create: jest.fn().mockResolvedValue(createMockReport()),
  },
  $transaction: jest.fn(<T>(callback: (() => T) | Promise<T>[]) => {
    if (typeof callback === "function") {
      return callback();
    }
    return Promise.all(callback);
  }),
});

/**
 * Create a mock AssignmentRepository with pre-defined implementations
 */
export const createMockAssignmentRepository = () => ({
  findById: jest.fn().mockResolvedValue(createMockGetAssignmentResponseDto()),
  findAllForUser: jest
    .fn()
    .mockResolvedValue([createMockAssignmentResponseDto()]),
  update: jest.fn().mockResolvedValue(createMockAssignment()),
  replace: jest.fn().mockResolvedValue(createMockAssignment()),
  processAssignmentData: jest
    .fn()
    .mockImplementation((rawAssignment: unknown): unknown => rawAssignment),
  parseJsonField: jest
    .fn()
    .mockImplementation((jsonValue: string | object): object | undefined => {
      if (typeof jsonValue === "string") {
        return JSON.parse(jsonValue) as object;
      }
      return jsonValue;
    }),
  createEmptyDto: jest.fn().mockReturnValue({
    instructions: undefined,
    numAttempts: undefined,
    attemptsBeforeCoolDown: undefined,
    retakeAttemptCoolDownMinutes: undefined,
    allotedTimeMinutes: undefined,
    attemptsPerTimeRange: undefined,
    attemptsTimeRangeHours: undefined,
    displayOrder: undefined,
  }),
});

/**
 * Create a mock QuestionRepository with pre-defined implementations
 */
export const createMockQuestionRepository = () => ({
  findById: jest.fn().mockResolvedValue(createMockQuestionDto()),
  findByAssignmentId: jest
    .fn()
    .mockResolvedValue([
      createMockQuestionDto(),
      createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
    ]),
  upsert: jest.fn().mockResolvedValue(createMockQuestionDto()),
  markAsDeleted: jest.fn().mockResolvedValue(undefined),
  createMany: jest
    .fn()
    .mockResolvedValue([
      createMockQuestionDto(),
      createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
    ]),
  mapToQuestionDto: jest
    .fn()
    .mockImplementation((question: { id: number }) =>
      createMockQuestionDto({ id: question.id }),
    ),
  parseJsonField: jest
    .fn()
    .mockImplementation((field: string | object): object | undefined => {
      if (typeof field === "string") {
        return JSON.parse(field) as object;
      }
      return field;
    }),
  prepareJsonField: jest.fn().mockImplementation((field) => {
    if (field === undefined || field === null) {
      return null;
    }
    return JSON.stringify(field);
  }),
  prepareQuestionData: jest
    .fn()
    .mockImplementation((questionData: Partial<Question>) => ({
      question: questionData.question,
      totalPoints: questionData.totalPoints,
      type: questionData.type,
      responseType: questionData.responseType,
      maxWords: questionData.maxWords,
      scoring: questionData.scoring,
      choices: JSON.stringify(questionData.choices),
      randomizedChoices: questionData.randomizedChoices ?? false,
      answer: questionData.answer,
      assignmentId: questionData.assignmentId,
      gradingContextQuestionIds: questionData.gradingContextQuestionIds,
      maxCharacters: questionData.maxCharacters,
      isDeleted: questionData.isDeleted ?? false,
      videoPresentationConfig: questionData.videoPresentationConfig,
      liveRecordingConfig: questionData.liveRecordingConfig,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
});

/**
 * Create a mock VariantRepository with pre-defined implementations
 */
export const createMockVariantRepository = () => ({
  findById: jest.fn().mockResolvedValue(createMockQuestionVariant()),
  findByQuestionId: jest.fn().mockResolvedValue([createMockQuestionVariant()]),
  create: jest.fn().mockResolvedValue(createMockQuestionVariant()),
  update: jest.fn().mockResolvedValue(createMockQuestionVariant()),
  markAsDeleted: jest.fn().mockResolvedValue(undefined),
  createMany: jest
    .fn()
    .mockResolvedValue([
      createMockQuestionVariant(),
      createMockQuestionVariant({ id: 102 }),
    ]),
  mapToVariantDto: jest
    .fn()
    .mockImplementation((variant: { id: number }) =>
      createMockVariantDto({ id: variant.id }),
    ),
  parseJsonField: jest
    .fn()
    .mockImplementation((field: string | object): unknown => {
      if (typeof field === "string") {
        return JSON.parse(field) as unknown;
      }
      return field;
    }),
  prepareJsonField: jest.fn().mockImplementation((field) => {
    if (field === undefined || field === null) {
      return null;
    }
    return JSON.stringify(field);
  }),
  prepareVariantCreateData: jest
    .fn()
    .mockImplementation((data: Partial<QuestionVariant>) => ({
      variantContent: data.variantContent,
      maxWords: data.maxWords,
      maxCharacters: data.maxCharacters,
      randomizedChoices: data.randomizedChoices ?? false,
      variantType: data.variantType ?? VariantType.REWORDED,
      createdAt: new Date(),
      choices: JSON.stringify(data.choices),
      scoring: JSON.stringify(data.scoring),
      variantOf: {
        connect: { id: data.questionId },
      },
    })),
  prepareVariantUpdateData: jest
    .fn()
    .mockImplementation((data: Partial<QuestionVariant>) => ({
      variantContent: data.variantContent,
      maxWords: data.maxWords,
      maxCharacters: data.maxCharacters,
      randomizedChoices: data.randomizedChoices ?? undefined,
      variantType: data.variantType,
      choices: JSON.stringify(data.choices),
      scoring: JSON.stringify(data.scoring),
    })),
});

/**
 * Create a mock QuestionService with pre-defined implementations
 */
export const createMockQuestionService = () => ({
  getQuestionsForAssignment: jest
    .fn()
    .mockResolvedValue([
      createMockQuestionDto(),
      createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
    ]),
  generateQuestionVariants: jest.fn().mockResolvedValue({
    id: 1,
    success: true,
    questions: [
      { ...createMockQuestionDto(), variants: [createMockVariantDto()] },
    ],
  }),
  processQuestionsForPublishing: jest.fn().mockResolvedValue(undefined),
  generateQuestions: jest
    .fn()
    .mockResolvedValue({ message: "Question generation started", jobId: 1 }),
  updateQuestionGradingContext: jest.fn().mockResolvedValue(undefined),
  applyGuardRails: jest.fn().mockResolvedValue(true),
  areChoicesEqual: jest.fn().mockReturnValue(true),
  checkVariantsForChanges: jest.fn().mockReturnValue(false),
  processVariantsForQuestion: jest.fn().mockResolvedValue(undefined),
  generateVariantsFromQuestion: jest
    .fn()
    .mockResolvedValue([createMockVariantDto()]),
  addVariantsToQuestion: jest.fn(),
  calculateRequiredVariants: jest.fn().mockReturnValue(2),
});

/**
 * Create a mock TranslationService with pre-defined implementations
 */
export const createMockTranslationService = () => ({
  getAvailableLanguages: jest.fn().mockResolvedValue(["en", "fr", "es"]),
  applyTranslationsToAssignment: jest.fn().mockResolvedValue(undefined),
  translateAssignment: jest.fn().mockResolvedValue(undefined),
  translateQuestion: jest.fn().mockResolvedValue(undefined),
  translateVariant: jest.fn().mockResolvedValue(undefined),
  ensureTranslationCompleteness: jest.fn().mockResolvedValue({
    missingTranslations: [],
    allComplete: true,
  }),
  applyTranslationsToAttempt: jest
    .fn()
    .mockImplementation((attempt: unknown): unknown => attempt),
  findExistingTranslation: jest.fn().mockResolvedValue(null),
  generateAndStoreTranslation: jest.fn().mockResolvedValue(undefined),
  prepareJsonValue: jest.fn().mockImplementation((value) => {
    if (value === undefined || value === null) {
      return null;
    }
    return JSON.stringify(value);
  }),
});

/**
 * Create a mock JobStatusService with pre-defined implementations
 */
export const createMockJobStatusService = () => ({
  createJob: jest.fn().mockResolvedValue(createMockJob()),
  createPublishJob: jest.fn().mockResolvedValue(createMockJob()),
  getJobStatus: jest.fn().mockResolvedValue(createMockJob()),
  getPublishJobStatusStream: jest.fn().mockReturnValue({
    pipe: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
  }),
  cleanupJobStream: jest.fn().mockResolvedValue(undefined),
  updateJobStatus: jest.fn().mockResolvedValue(undefined),
  emitJobStatusUpdate: jest.fn(),
});

/**
 * Create a mock LlmFacadeService with pre-defined implementations
 */
export const createMockLlmFacadeService = () => ({
  getLanguageCode: jest.fn().mockResolvedValue("en"),
  translateText: jest
    .fn()
    .mockImplementation((text: string) =>
      Promise.resolve(`Translated: ${text}`),
    ),
  generateQuestionRewordings: jest.fn().mockResolvedValue([
    {
      id: 101,
      variantContent: "What city serves as the capital of France?",
      variantType: VariantType.REWORDED,
      choices: [sampleChoiceA, sampleChoiceB, sampleChoiceC],
    },
    {
      id: 102,
      variantContent: "Which city is the capital of France?",
      variantType: VariantType.REWORDED,
      choices: [sampleChoiceA, sampleChoiceB, sampleChoiceC],
    },
  ]),
  generateQuestionGradingContext: jest.fn().mockResolvedValue({
    "1": [2],
    "2": [1],
  }),
  generateQuestionTranslation: jest
    .fn()
    .mockImplementation((_assignmentId: number, text: string) =>
      Promise.resolve(`Translated: ${text}`),
    ),
  generateChoicesTranslation: jest.fn().mockResolvedValue([
    { ...sampleChoiceA, choice: "Translated choice A" },
    { ...sampleChoiceB, choice: "Translated choice B" },
    { ...sampleChoiceC, choice: "Translated choice C" },
  ]),
  processMergedContent: jest.fn().mockResolvedValue([createMockQuestionDto()]),
  sanitizeContent: jest
    .fn()
    .mockImplementation((content: unknown): unknown => content),
  applyGuardRails: jest.fn().mockResolvedValue(true),
  gradeTextBasedQuestion: jest.fn().mockResolvedValue({
    totalPoints: 10,
    feedback: [{ feedback: "Great answer!" }],
    gradingRationale: "The answer was comprehensive and accurate.",
  }),
});

/**
 * Create a mock ReportService with pre-defined implementations
 */
export const createMockReportService = () => ({
  createReport: jest.fn().mockResolvedValue(undefined),
  validateReportInputs: jest.fn(),
  checkRateLimit: jest.fn().mockResolvedValue(undefined),
});

/**
 * Create a mock AssignmentServiceV2 with pre-defined implementations
 */
export const createMockAssignmentService = () => ({
  getAssignment: jest
    .fn()
    .mockResolvedValue(createMockGetAssignmentResponseDto()),
  listAssignments: jest
    .fn()
    .mockResolvedValue([createMockAssignmentResponseDto()]),
  updateAssignment: jest
    .fn()
    .mockResolvedValue(createMockBaseAssignmentResponseDto()),
  replaceAssignment: jest
    .fn()
    .mockResolvedValue(createMockBaseAssignmentResponseDto()),
  getAvailableLanguages: jest.fn().mockResolvedValue(["en", "fr", "es"]),
  publishAssignment: jest
    .fn()
    .mockResolvedValue({ jobId: 1, message: "Publishing started" }),
  startPublishingProcess: jest.fn().mockResolvedValue(undefined),
  shouldTranslateAssignment: jest.fn().mockReturnValue(true),
  haveTranslatableAssignmentFieldsChanged: jest.fn().mockReturnValue(true),
  haveQuestionContentsChanged: jest.fn().mockReturnValue(true),
  haveVariantsChanged: jest.fn().mockReturnValue(false),
  areChoicesEqual: jest.fn().mockReturnValue(true),
  safeStringCompare: jest.fn().mockImplementation((string1, string2) => {
    return String(string1 || "") === String(string2 || "");
  }),
});

/**
 * Create a mock AttemptServiceV2 with pre-defined implementations
 */
export const createMockAttemptService = () => ({
  createAssignmentAttempt: jest
    .fn()
    .mockResolvedValue({ id: 1, success: true }),
  listAssignmentAttempts: jest
    .fn()
    .mockResolvedValue([createMockAssignmentAttempt()]),
  getAssignmentAttempt: jest
    .fn()
    .mockResolvedValue(createMockAssignmentAttempt()),
  getLearnerAssignmentAttempt: jest
    .fn()
    .mockResolvedValue(createMockAssignmentAttempt({}, true)),
  updateAssignmentAttempt: jest
    .fn()
    .mockResolvedValue(createMockAssignmentAttempt({}, true)),
  submitFeedback: jest.fn().mockResolvedValue(createMockAssignmentFeedback()),
  getFeedback: jest.fn().mockResolvedValue(createMockAssignmentFeedback()),
  processRegradingRequest: jest
    .fn()
    .mockResolvedValue(createMockRegradingRequest()),
  getRegradingStatus: jest.fn().mockResolvedValue(createMockRegradingRequest()),
  createReport: jest.fn().mockResolvedValue(undefined),
});

/**
 * Create a mock VersionManagementService with pre-defined implementations
 */
export const createMockVersionManagementService = () => ({
  createVersion: jest.fn().mockResolvedValue({
    id: 1,
    versionNumber: 1,
    versionDescription: "Test version",
    isDraft: false,
    isActive: true,
    createdBy: "test-user",
    createdAt: new Date(),
    questionCount: 2,
  }),
  listVersions: jest.fn().mockResolvedValue([]),
  getVersion: jest.fn().mockResolvedValue(null),
  saveDraft: jest.fn().mockResolvedValue({
    id: 1,
    versionNumber: 1,
    versionDescription: "Draft version",
    isDraft: true,
    isActive: false,
    createdBy: "test-user",
    createdAt: new Date(),
    questionCount: 2,
  }),
  restoreVersion: jest.fn().mockResolvedValue({
    id: 2,
    versionNumber: 2,
    versionDescription: "Restored version",
    isDraft: false,
    isActive: true,
    createdBy: "test-user",
    createdAt: new Date(),
    questionCount: 2,
  }),
  compareVersions: jest.fn().mockResolvedValue({
    fromVersion: {
      id: 1,
      versionNumber: 1,
      versionDescription: "From version",
      isDraft: false,
      isActive: false,
      createdBy: "test-user",
      createdAt: new Date(),
      questionCount: 2,
    },
    toVersion: {
      id: 2,
      versionNumber: 2,
      versionDescription: "To version",
      isDraft: false,
      isActive: true,
      createdBy: "test-user",
      createdAt: new Date(),
      questionCount: 2,
    },
    assignmentChanges: [],
    questionChanges: [],
  }),
  getVersionHistory: jest.fn().mockResolvedValue([]),
  getUserLatestDraft: jest.fn().mockResolvedValue(null),
  restoreDeletedQuestions: jest.fn().mockResolvedValue(undefined),
  updateVersionDescription: jest.fn().mockResolvedValue(undefined),
});
