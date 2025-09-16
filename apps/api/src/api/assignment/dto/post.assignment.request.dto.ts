import { QuestionType, ResponseType } from "@prisma/client";
import { AssignmentTypeEnum } from "src/api/llm/features/question-generation/services/question-generation.service";

export interface QuestionsToGenerate {
  multipleChoice: number;
  multipleSelect: number;
  textResponse: number;
  trueFalse: number;
}
export interface QuestionGenerationPayload {
  assignmentId: number;
  assignmentType: AssignmentTypeEnum;
  questionsToGenerate: EnhancedQuestionsToGenerate;
  fileContents: { filename: string; content: string }[];
  learningObjectives: string;
}
export interface EnhancedQuestionsToGenerate extends QuestionsToGenerate {
  url?: number;
  upload?: number;
  linkFile?: number;
  responseTypes?: {
    [key in QuestionType]?: ResponseType[];
  };
}
