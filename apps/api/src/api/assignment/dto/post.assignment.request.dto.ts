import { AssignmentTypeEnum } from "./update.assignment.request.dto";

export interface QuestionsToGenerate {
  multipleChoice: number;
  multipleSelect: number;
  textResponse: number;
  trueFalse: number;
}
export interface QuestionGenerationPayload {
  assignmentId: number;
  assignmentType: AssignmentTypeEnum;
  questionsToGenerate: QuestionsToGenerate;
  fileContents: { filename: string; content: string }[];
  learningObjectives: string[];
}
