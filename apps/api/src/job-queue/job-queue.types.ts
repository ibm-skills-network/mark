import {
  QuestionDto,
  UpdateAssignmentQuestionsDto,
  VariantDto,
} from "../api/assignment/dto/update.questions.request.dto";
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

export interface AssignmentV2RetryFailedTranslationsJobPayload {
  jobId: string;
  assignmentId: number;
  // The publish job whose status hash holds the failed entries to retry.
  // Reuses the deterministic publish:v2:${assignmentId} jobId so the server
  // can always identify the most recent publish without the client passing
  // it explicitly.
  sourcePublishJobId: string;
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

export interface TranslateQuestionJobPayload {
  parentJobId: string;
  assignmentId: number;
  questionId: number;
  question: QuestionDto;
  // When true, the worker deletes every existing Translation row for the
  // (questionId, variantId=null) tuple before re-translating all 23
  // languages. Publish passes true only when translatable content changed.
  // Retry of failed translations and metadata-only republishes pass false so
  // the worker only translates languages that are still missing, preserving
  // rows that landed successfully in the prior publish.
  forceRetranslation?: boolean;
}

export interface TranslateVariantJobPayload {
  parentJobId: string;
  assignmentId: number;
  questionId: number;
  variantId: number;
  variant: VariantDto;
  forceRetranslation?: boolean;
}

/**
 * The assignment text a TRANSLATE_META job should translate, as published.
 *
 * Carried in the payload for the same reason TRANSLATE_QUESTION carries its
 * `question`: the worker starts within milliseconds of the enqueue, while
 * publish is still writing. Publish enqueues this job before it snapshots the
 * new version, so a worker that re-read the assignment would resolve the
 * *previous* active version and translate the text one publish out of date.
 *
 * Fields left undefined fall back to the assignment's live text, which is what
 * the enqueue sites outside publish rely on.
 */
export interface TranslateMetaTextPayload {
  name?: string | null;
  introduction?: string | null;
  instructions?: string | null;
  gradingCriteriaOverview?: string | null;
}

export interface TranslateMetaJobPayload {
  // parentJobId is optional: the publish-driven enqueue passes the publish jobId so
  // the worker can HSET into the per-publish translation-status hash. The
  // updateAssignment standalone enqueue (no SSE consumer) omits it; the worker
  // skips the per-publish HSET when absent.
  parentJobId?: string;
  assignmentId: number;
  forceRetranslation?: boolean;
  // Absent on the standalone and retry enqueues, which have no published text
  // in hand and want whatever is live when the worker runs.
  text?: TranslateMetaTextPayload;
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

export interface FileExtractJobPayload {
  assignmentId: number;
  fileId: number;
}
