import { FileUploadQuestionEvaluateModel } from "../../../model/file.based.question.evaluate.model";
import { FileBasedQuestionResponseModel } from "../../../model/file.based.question.response.model";

export interface IFileGradingService {
  /**
   * Grade a file-based question response
   */
  gradeFileBasedQuestion(
    model: FileUploadQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<FileBasedQuestionResponseModel>;
}
