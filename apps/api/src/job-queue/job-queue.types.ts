import { UpdateAssignmentQuestionsDto } from "../api/assignment/dto/update.questions.request.dto";
import {
  EnhancedQuestionsToGenerate,
  QuestionsToGenerate,
} from "../api/assignment/dto/post.assignment.request.dto";
import { LearnerUpdateAssignmentAttemptRequestDto } from "../api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import { AssignmentTypeEnum } from "../api/llm/features/question-generation/services/question-generation.service";
import { UserSession } from "../auth/interfaces/user.session.interface";

export interface FileContentPayload {
  filename: string;
  content: string;
}

export interface AssignmentV1GenerateQuestionsJobPayload {
  jobId: string;
  assignmentId: number;
  assignmentType: AssignmentTypeEnum;
  questionsToGenerate: QuestionsToGenerate;
  files?: FileContentPayload[];
  learningObjectives?: string;
}

export interface AssignmentV2GenerateQuestionsJobPayload {
  jobId: string;
  assignmentId: number;
  assignmentType: AssignmentTypeEnum;
  questionsToGenerate: EnhancedQuestionsToGenerate;
  fileContents?: FileContentPayload[];
  learningObjectives?: string;
}

export interface AssignmentV2PublishJobPayload {
  jobId: string;
  assignmentId: number;
  updateDto: UpdateAssignmentQuestionsDto;
  userId: string;
}

export type AttemptWorkerUserSession = Pick<
  UserSession,
  "userId" | "role" | "gradingCallbackRequired"
>;

export interface AttemptGradeJobPayload {
  gradingJobId: string;
  attemptId: number;
  assignmentId: number;
  updateDto: LearnerUpdateAssignmentAttemptRequestDto;
  authCookie?: string;
  userSession: AttemptWorkerUserSession;
}

export interface AttemptAuthorPreviewJobPayload {
  gradingJobId: string;
  assignmentId: number;
  updateDto: LearnerUpdateAssignmentAttemptRequestDto;
  userSession: AttemptWorkerUserSession;
}

export interface FixMissingTranslationsJobRequest {
  assignmentIds?: number[];
  assignmentId?: number;
  includeAll?: boolean;
  dryRun?: boolean;
  languageCodes?: string[];
  maxMissing?: number;
}

export interface SweepTranslationsJobRequest {
  batchSize?: number;
  maxBatches?: number;
  languageCodes?: string[];
  dryRun?: boolean;
  delayBetweenBatchesMs?: number;
  includeAll?: boolean;
}

export interface AdminFixMissingTranslationsJobPayload {
  jobId: string;
  assignmentIds: number[];
  body: FixMissingTranslationsJobRequest;
}

export interface AdminSweepMissingTranslationsJobPayload {
  jobId: string;
  body: SweepTranslationsJobRequest;
}
