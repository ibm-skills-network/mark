/**
 * Error handling for the browser-side video pipeline behind live-recording
 * questions.
 *
 * That pipeline runs entirely in the learner's browser — load the ffmpeg core,
 * extract the audio, transcribe it, analyse body language, ask for coaching
 * feedback — and the answer is only stored once it finishes. A single catch-all
 * around the whole chain therefore turns any one broken stage into an
 * unexplained "try again" with a permanently disabled Submit, and leaves no
 * trace of the real error anywhere. These helpers keep the failing stage
 * attached to the error, so the learner gets an accurate message and the real
 * cause reaches the console.
 */

export type PresentationStage =
  | "video-tools"
  | "audio-extraction"
  | "transcription"
  | "body-language"
  | "coach-feedback";

export interface PresentationLogContext {
  assignmentId: number;
  questionId: number;
}

interface RunStageOptions {
  /** Reject instead of hanging forever. The ffmpeg worker never rejects on its own. */
  timeoutMs?: number;
}

interface ResolveDurationOptions {
  /** Used when the recording never reports a usable duration. */
  fallbackSeconds: number;
  attempts?: number;
  delayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const STAGE_MESSAGES: Record<PresentationStage, string> = {
  "video-tools":
    "Your browser could not start the video tools needed for this question. Reload the page and try recording again.",
  "audio-extraction":
    "We could not read the audio from your recording. Please record again, and try another browser if it keeps failing.",
  transcription:
    "We could not transcribe your recording. Please wait a moment and record again.",
  "body-language":
    "We could not analyse the video from your recording. Please record again.",
  "coach-feedback":
    "Your recording was processed, but coaching feedback is unavailable right now. You can still submit your answer.",
};

const GENERIC_MESSAGE =
  "We could not process your recording. Please record again.";

const DEFAULT_DURATION_ATTEMPTS = 50;
const DEFAULT_DURATION_DELAY_MS = 100;

export class PresentationStageError extends Error {
  readonly stage: PresentationStage;

  constructor(
    stage: PresentationStage,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PresentationStageError";
    this.stage = stage;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describe(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: typeof error, message: String(error) };
}

/**
 * Runs one stage of the pipeline, tagging whatever it throws with that stage.
 * An already-tagged error passes through untouched so the innermost stage wins.
 */
export async function runPresentationStage<T>(
  stage: PresentationStage,
  operation: () => Promise<T>,
  options: RunStageOptions = {},
): Promise<T> {
  const { timeoutMs } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const work = operation();
    if (timeoutMs === undefined) {
      return await work;
    }

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new PresentationStageError(
              stage,
              `${stage} timed out after ${timeoutMs}ms`,
            ),
          ),
        timeoutMs,
      );
    });
    return await Promise.race([work, timeout]);
  } catch (error) {
    if (error instanceof PresentationStageError) {
      throw error;
    }
    throw new PresentationStageError(stage, `${stage} failed`, {
      cause: error,
    });
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** The learner-facing message for a failure, specific to the stage that broke. */
export function presentationErrorMessage(error: unknown): string {
  if (error instanceof PresentationStageError) {
    return STAGE_MESSAGES[error.stage];
  }
  return GENERIC_MESSAGE;
}

/**
 * Records the real error. Nothing about the video pipeline is logged
 * server-side, so this console entry is what support has to work from: it
 * carries the stage and the ids, never the recording or the transcript.
 */
export function logPresentationFailure(
  error: unknown,
  context: PresentationLogContext,
): void {
  const stage =
    error instanceof PresentationStageError ? error.stage : "unknown";
  const reported =
    error instanceof PresentationStageError && error.cause
      ? error.cause
      : error;
  const { name, message, stack } = describe(reported);

  console.error("presentation.processing.failed", {
    stage,
    assignmentId: context.assignmentId,
    questionId: context.questionId,
    errorName: name,
    errorMessage: message,
    stack,
  });
}

/**
 * Waits a bounded number of times for the browser to work out how long a
 * recording is. Recordings produced by MediaRecorder routinely report
 * `Infinity` until the whole blob has been parsed, and some never report
 * anything usable — which used to spin forever with the question stuck on
 * "Processing video".
 */
export async function resolveVideoDuration(
  video: Pick<HTMLVideoElement, "duration">,
  options: ResolveDurationOptions,
): Promise<number> {
  const {
    fallbackSeconds,
    attempts = DEFAULT_DURATION_ATTEMPTS,
    delayMs = DEFAULT_DURATION_DELAY_MS,
    sleep = delay,
  } = options;

  const usable = (duration: number) =>
    typeof duration === "number" && Number.isFinite(duration) && duration > 0;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (usable(video.duration)) {
      return video.duration;
    }
    await sleep(delayMs);
  }

  return usable(video.duration) ? video.duration : fallbackSeconds;
}
