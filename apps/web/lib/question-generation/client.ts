import { QuestionAuthorStore, QuestionGenerationPayload } from "@/config/types";
import { getJobStatus, uploadFiles } from "@/lib/talkToBackend";

export type QuestionGenerationStatus = {
  status: string;
  progress: string;
  progressPercentage?: string;
  questions?: QuestionAuthorStore[];
};

type PollQuestionGenerationJobOptions = {
  jobId: number;
  intervalMs?: number;
  onUpdate: (status: QuestionGenerationStatus) => void;
  onCompleted: (status: QuestionGenerationStatus) => void;
  onFailed: (status: QuestionGenerationStatus) => void;
  onError: (error: unknown) => void;
};

/**
 * Start a backend question-generation job.
 */
export async function startQuestionGenerationJob(
  payload: QuestionGenerationPayload,
): Promise<number> {
  const response = await uploadFiles(payload);

  if (!response.success || !response.jobId) {
    throw new Error("Failed to upload files");
  }

  return response.jobId;
}

/**
 * Poll backend job status until completion or failure.
 * Returns a cleanup function to stop polling.
 */
export function pollQuestionGenerationJob({
  jobId,
  intervalMs = 2500,
  onUpdate,
  onCompleted,
  onFailed,
  onError,
}: PollQuestionGenerationJobOptions): () => void {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  intervalId = setInterval(async () => {
    try {
      const statusData = await getJobStatus(jobId);

      if (!statusData) {
        throw new Error("Failed to fetch job status");
      }

      onUpdate(statusData);

      if (statusData.status === "Completed") {
        stop();
        onCompleted(statusData);
      } else if (statusData.status === "Failed") {
        stop();
        onFailed(statusData);
      }
    } catch (error: unknown) {
      stop();
      onError(error);
    }
  }, intervalMs);

  return stop;
}
