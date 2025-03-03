/**
 * This file is used to talk to the backend.
 */
import { BASE_API_ROUTES } from "@config/constants";
import type {
  Assignment,
  AssignmentAttempt,
  AssignmentAttemptWithQuestions,
  AssignmentDetails,
  AssignmentFeedback,
  BaseBackendResponse,
  Choice,
  CreateQuestionRequest,
  GetAssignmentResponse,
  PublishJobResponse,
  Question,
  QuestionAttemptRequest,
  QuestionAttemptRequestWithId,
  QuestionAttemptResponse,
  QuestionAuthorStore,
  QuestionGenerationPayload,
  QuestionStore,
  QuestionType,
  QuestionVariants,
  RegradingRequest,
  ReplaceAssignmentRequest,
  REPORT_TYPE,
  ResponseType,
  SubmitAssignmentResponse,
  UpdateAssignmentQuestionsResponse,
  User,
} from "@config/types";
import { toast } from "sonner";
import { absoluteUrl } from "./utils";

const BASE_API_PATH = absoluteUrl("/api/v1");

// TODO: change the error message to use the error message from the backend

/**
 * Calls the backend to see who the user is (author, learner, or admin).
 */
export async function getUser(cookies?: string): Promise<User | undefined> {
  try {
    const res = await fetch(BASE_API_ROUTES.user, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch user");
    }

    return (await res.json()) as User;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Calls the backend to modify an assignment.
 */
export async function replaceAssignment(
  data: ReplaceAssignmentRequest,
  id: number,
  cookies?: string,
): Promise<boolean> {
  try {
    //
    const res = await fetch(BASE_API_ROUTES.assignments + `/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to replace assignment");
    }
    const { success, error } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Calls the backend to update an assignment.
 */
export async function updateAssignment(
  data: Partial<ReplaceAssignmentRequest>,
  id: number,
  cookies?: string,
): Promise<boolean> {
  try {
    const res = await fetch(BASE_API_ROUTES.assignments + `/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to update assignment");
    }
    const { success, error } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Calls the backend to get an assignment.
 * @param id The id of the assignment to get.
 * @returns The assignment if it exists, undefined otherwise.
 * @throws An error if the request fails.
 * @throws An error if the assignment does not exist.
 * @throws An error if the user is not authorized to view the assignment.
 */
export async function getAssignment(
  id: number,
  userPreferedLanguage?: string,
  cookies?: string,
): Promise<Assignment | undefined> {
  try {
    const url = userPreferedLanguage
      ? `${BASE_API_ROUTES.assignments}/${id}?lang=${userPreferedLanguage}`
      : `${BASE_API_ROUTES.assignments}/${id}`;
    const res = await fetch(url, {
      headers: {
        "Cache-Control": "no-cache",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch assignment");
    }
    const { success, error, ...remainingData } =
      (await res.json()) as GetAssignmentResponse;
    if (!success) {
      throw new Error(error);
    }
    const assignmentData: Assignment = remainingData;
    return assignmentData;
  } catch (err) {
    console.error(err);
    // TODO: handle error in a better way with the help of the response code
    return undefined;
  }
}

/**
 * Calls the backend to get all assignments.
 * @returns An array of assignments.
 */
export async function getAssignments(
  cookies?: string,
): Promise<Assignment[] | undefined> {
  try {
    const res = await fetch(BASE_API_ROUTES.assignments, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch assignments");
    }
    const assignments = (await res.json()) as Assignment[];
    return assignments;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Creates a question for a given assignment.
 * @param assignmentId The id of the assignment to create the question for.
 * @param question The question to create.
 * @returns The id of the created question.
 * @throws An error if the request fails.
 */
export async function createQuestion(
  assignmentId: number,
  question: CreateQuestionRequest,
  cookies?: string,
): Promise<number | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/questions`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(question),
    });

    if (!res.ok) {
      throw new Error("Failed to create question");
    }
    const { success, error, id } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }

    return id;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}
export function subscribeToJobStatus(
  jobId: number,
  onProgress?: (percentage: number, progressText?: string) => void,
  setQuestions?: (questions: Question[]) => void,
): Promise<[boolean, Question[]]> {
  return new Promise<[boolean, Question[]]>((resolve, reject) => {
    let eventSource: EventSource | null = null;
    let timeoutId: NodeJS.Timeout;
    let isResolved = false;
    const controller = new AbortController();
    let receivedQuestions: Question[] = [];

    const cleanUp = () => {
      controller.abort();
      eventSource?.close();
      clearTimeout(timeoutId);
      eventSource = null;
    };

    const handleCompletion = (success: boolean) => {
      if (!isResolved) {
        isResolved = true;
        cleanUp();
        resolve([success, receivedQuestions]);
      }
    };

    const handleError = (error: string) => {
      if (!isResolved) {
        isResolved = true;
        cleanUp();
        reject(new Error(error));
      }
    };

    // Initial connection timeout (30 seconds)
    timeoutId = setTimeout(() => handleError("Connection timeout"), 30000);

    try {
      eventSource = new EventSource(
        `${BASE_API_ROUTES.assignments}/jobs/${jobId}/status-stream?_=${Date.now()}`,
        { withCredentials: true },
      );

      // Abort the connection when the controller signal is aborted
      controller.signal.addEventListener("abort", () => {
        eventSource?.close();
      });

      eventSource.onopen = () => {
        console.log("SSE connection established");
        clearTimeout(timeoutId);
        // Set job processing timeout (e.g. 5 minutes)
        timeoutId = setTimeout(
          () => handleError("Job processing timeout"),
          300000,
        );
      };

      // Listen for "update" events
      eventSource.addEventListener("update", (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as PublishJobResponse;
          // Report progress updates if available
          if (data.percentage !== undefined && onProgress) {
            onProgress(data.percentage, data.progress);
          }
          // Update questions if present
          if (data.result?.questions) {
            receivedQuestions = data.result.questions;
            if (setQuestions) {
              setQuestions(receivedQuestions);
            }
          }
          if (data.done) {
            clearTimeout(timeoutId);
            handleCompletion(data.status === "Completed");
          } else if (data.status === "Failed") {
            handleError(data.progress || "Job failed");
          }
        } catch (parseError) {
          handleError("Invalid server response");
        }
      });

      // Listen for "finalize" events
      eventSource.addEventListener(
        "finalize",
        (event: MessageEvent<string>) => {
          try {
            const data = JSON.parse(event.data) as PublishJobResponse;
            if (data.percentage !== undefined && onProgress) {
              onProgress(data.percentage, data.progress);
            }
            if (data.result?.questions) {
              receivedQuestions = data.result.questions;
              if (setQuestions) {
                setQuestions(receivedQuestions);
              }
            }
            handleCompletion(data.status === "Completed");
          } catch {
            handleError("Invalid finalize event response");
          }
        },
      );

      // Optional: Listen for "close" events
      eventSource.addEventListener("close", (event: MessageEvent<string>) => {
        console.log("SSE close event:", event.data);
      });

      eventSource.onerror = (err) => {
        console.error("SSE error:", err);
        if (!isResolved) {
          if (eventSource?.readyState === EventSource.CLOSED) {
            handleError("Connection closed unexpectedly");
          } else {
            setTimeout(() => {
              if (!isResolved) handleError("Connection error");
            }, 2000);
          }
        }
      };
    } catch (error) {
      handleError("Failed to establish SSE connection");
    }
  });
}

export async function publishAssignment(
  assignmentId: number,
  updatedAssignment: ReplaceAssignmentRequest,
  cookies?: string,
): Promise<{ jobId: number; message: string } | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/publish`;

  // Manually define the payload fields
  const payload = {
    ...updatedAssignment, // Spread the properties directly
  };

  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to start publishing job");
    }

    // Response should now contain jobId instead of questions
    const { jobId, message } = (await res.json()) as {
      jobId: number;
      message: string;
    };
    return { jobId, message };
  } catch (err) {
    console.error("Error starting publishing job:", err);
  }
}

/**
 * Updates a question for a given assignment.
 * @param assignmentId The id of the assignment to update the question for.
 * @param questionId The id of the question to update.
 * @param question The question to update.
 * @returns The id of the updated question.
 * @throws An error if the request fails.
 */
export async function replaceQuestion(
  assignmentId: number,
  questionId: number,
  question: CreateQuestionRequest,
  cookies?: string,
): Promise<number | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/questions/${questionId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(question),
    });

    if (!res.ok) {
      throw new Error("Failed to update question");
    }
    const { success, error, id } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }

    return id;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

export async function generateQuestionVariant(
  questionsFromFrontend: QuestionAuthorStore[],
  questionVariationNumber: number,
  assignmentId: number,
  cookies?: string,
): Promise<QuestionAuthorStore[] | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/question/generate-variant`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({
        questions: questionsFromFrontend,
        questionVariationNumber,
      }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(
        errorBody.message || "Failed to generate question variant",
      );
    }
    const { success, error, questions } =
      (await res.json()) as BaseBackendResponse & {
        questions: QuestionAuthorStore[];
      };

    if (!success) {
      throw new Error(error);
    }

    return questions;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

export async function generateRubric(
  questions: {
    id: number;
    questionText: string;
    questionType: string;
    responseType: ResponseType;
  }[],
  assignmentId: number,
  variantMode: boolean,
  cookies?: string,
): Promise<Record<number, string> | undefined> {
  const endpointURL = `${BASE_API_ROUTES.rubric}/${assignmentId}/questions/create-marking-rubric`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ questions, variantMode }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to generate rubric");
    }
    const rubric = (await res.json()) as Record<number, string>;
    return rubric;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Deletes a question for a given assignment.
 */
export async function deleteQuestion(
  assignmentId: number,
  questionId: number,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/questions/${questionId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      throw new Error("Failed to delete question");
    }
    const { success, error } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Gets a list of attempts for a given assignment.
 * @param assignmentId The id of the assignment to get attempts for.
 * @returns An array of attempts.
 * @throws An error if the request fails.
 * @throws An error if the user is not authorized to view the attempts.
 */
export async function getAttempts(
  assignmentId: number,
  cookies?: string,
): Promise<AssignmentAttempt[] | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch attempts");
    }
    const attempts = (await res.json()) as AssignmentAttempt[];
    return attempts;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Creates a attempt for a given assignment.
 * @param assignmentId The id of the assignment to create the attempt for.
 * @returns The id of the created attempt.
 * @throws An error if the request fails.
 */
export async function createAttempt(
  assignmentId: number,
  cookies?: string,
): Promise<number | undefined | "no more attempts"> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts`;
  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      if (res.status === 422) {
        return "no more attempts";
      }
      throw new Error(errorBody.message || "Failed to create attempt");
    }
    const { success, error, id } = (await res.json()) as BaseBackendResponse;
    if (!success) {
      throw new Error(error);
    }

    return id;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * gets the questions for a given uncompleted attempt and assignment
 * @param assignmentId The id of the assignment to get the questions for.
 * @param attemptId The id of the attempt to get the questions for.
 * @returns An array of questions.
 * @throws An error if the request fails.
 */
export async function getAttempt(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
  language = "en",
): Promise<AssignmentAttemptWithQuestions | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts/${attemptId}?lang=${language}`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to get attempt questions");
    }
    const attempt = (await res.json()) as AssignmentAttemptWithQuestions;
    return attempt;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}
/**
 * Fetches the supported languages for an assignment.
 * @param assignmentId The ID of the assignment.
 * @returns An array of supported language codes.
 * @throws An error if the request fails.
 */
export async function getSupportedLanguages(
  assignmentId: number,
): Promise<string[]> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/languages`;

  try {
    const res = await fetch(endpointURL);

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch languages");
    }

    const data = (await res.json()) as { languages: string[] };
    if (!data.languages) {
      throw new Error("Failed to fetch languages");
    }
    return data.languages || [];
  } catch (err) {
    console.error("Error fetching languages:", err);
    return ["en"]; // Default fallback to English if API fails
  }
}
/**
 * gets the questions for a given compelted attempt and assignment
 * @param assignmentId The id of the assignment to get the questions for.
 * @param attemptId The id of the attempt to get the questions for.
 * @returns An array of questions.
 * @throws An error if the request fails.
 */
export async function getCompletedAttempt(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
): Promise<AssignmentAttemptWithQuestions | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts/${attemptId}/completed`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to get attempt questions");
    }
    const attempt = (await res.json()) as AssignmentAttemptWithQuestions;
    return attempt;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Submits an answer for a given assignment, attempt, and question.
 */
export async function submitQuestion(
  assignmentId: number,
  attemptId: number,
  questionId: number,
  requestBody: QuestionAttemptRequest,
  cookies?: string,
): Promise<QuestionAttemptResponse | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts/${attemptId}/questions/${questionId}/responses`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      // remove empty fields
      body: JSON.stringify(requestBody, (key, value) => {
        if (value === "" || value === null || value === undefined) {
          return undefined;
        }
        return value as QuestionAttemptRequest;
      }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to submit question");
    }
    const data = (await res.json()) as QuestionAttemptResponse;
    return data;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

/**
 * Submits an assignment for a given assignment and attempt.
 */
export async function submitAssignment(
  assignmentId: number,
  attemptId: number,
  responsesForQuestions: QuestionAttemptRequestWithId[],
  language?: string,
  authorQuestions?: QuestionStore[],
  authorAssignmentDetails?: ReplaceAssignmentRequest,
  cookies?: string,
): Promise<SubmitAssignmentResponse | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts/${attemptId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "PATCH",
      body: JSON.stringify({
        submitted: true,
        responsesForQuestions,
        language,
        authorQuestions: authorQuestions || undefined,
        authorAssignmentDetails: authorAssignmentDetails || undefined,
      }),
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message);
    }
    const data = (await res.json()) as SubmitAssignmentResponse;
    return data;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

// src/lib/talkToBackend.ts

export async function uploadFiles(
  payload: QuestionGenerationPayload,
  cookies?: string,
): Promise<{ success: boolean; jobId?: number }> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${payload.assignmentId}/upload-files`;
  const TIMEOUT = 1000000;

  try {
    const res = (await Promise.race([
      fetch(endpointURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Connection: "keep-alive",
          KeepAlive: "timeout=1000000",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: JSON.stringify({ ...payload }),
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), TIMEOUT),
      ),
    ])) as Response;

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to upload files");
    }

    // Parse the response
    const data = (await res.json()) as {
      success: boolean;
      jobId?: number;
    };

    // Return the data if successful
    if (data.jobId) {
      return {
        success: true,
        jobId: data.jobId, // Include the jobId for progress tracking
      };
    } else {
      return { success: false };
    }
  } catch (err) {
    console.error("Error uploading files:", err);
    return { success: false };
  }
}

/**
 * Fetches the status of a job by its ID.
 * @param jobId The ID of the job to check.
 * @param cookies Optional cookies for authentication.
 * @returns An object containing the job status and progress.
 */
export async function getJobStatus(
  jobId: number,
  cookies?: string,
): Promise<
  | {
      status: string;
      progress: string;
      progressPercentage: string;
      questions?: string;
    }
  | undefined
> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/jobs/${jobId}/status`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch job status");
    }

    const data = (await res.json()) as {
      status: string;
      progress: string;
      progressPercentage: string;
      questions?: string;
    };
    return data;
  } catch (err) {
    console.error("Error fetching job status:", err);
    return undefined;
  }
}
export async function getFeedback(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
): Promise<AssignmentFeedback | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts/${attemptId}/feedback`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch feedback");
    }

    const data = (await res.json()) as AssignmentFeedback;
    return data;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}
export async function submitFeedback(
  assignmentId: number,
  attemptId: number,
  feedback: AssignmentFeedback,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts/${attemptId}/feedback`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ feedback }),
    });

    if (!res.ok) {
      throw new Error("Failed to submit feedback");
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export async function submitRegradingRequest(
  regradingRequest: RegradingRequest,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${regradingRequest.assignmentId}/attempts/${regradingRequest.attemptId}/regrade`;
  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ regradingRequest }),
    });

    if (!res.ok) {
      throw new Error("Failed to submit regrading request");
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}
export async function submitReportAuthor(
  assignmentId: number,
  issueType: REPORT_TYPE,
  description: string,
  cookies?: string,
): Promise<{ success: boolean } | undefined> {
  try {
    const response:
      | Response
      | {
          status: number;
          message: string;
        } = await fetch(
      `${BASE_API_ROUTES.assignments}/${assignmentId}/report`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: JSON.stringify({
          issueType,
          description,
        }),
      },
    );

    if (response.status === 422) {
      throw new Error(
        "You have reached the maximum number of reports allowed in a 24-hour period.",
      );
    } else if (!response.ok) {
      throw new Error("Failed to submit report");
    }

    return (await response.json()) as { success: boolean };
  } catch (error: unknown) {
    if (error instanceof Error) {
      toast.error(error.message);
    } else {
      toast.error("Failed to submit report");
    }
  }
}
export async function AuthorizeGithubBackend(
  assignmentId: number,
  redirectUrl: string,
  cookies?: string,
): Promise<{ url: string } | undefined> {
  try {
    const res = await fetch(`${BASE_API_PATH}/github/oauth-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ assignmentId, redirectUrl }),
    });

    if (!res.ok) {
      throw new Error("Failed to fetch OAuth URL");
    }

    return (await res.json()) as { url: string };
  } catch (error: unknown) {
    if (error instanceof Error) {
      toast.error(error.message);
    } else {
      toast.error("Failed to fetch OAuth URL");
    }
  }
}
/**
 * Fetches a stored GitHub token for the current user from the backend.
 *
 * @param cookies Optional cookies for server-side calls.
 * @returns The GitHub token if found, or null if not found or expired.
 */
export async function getStoredGithubToken(
  cookies?: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_API_PATH}/github/github_token`, {
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      return null;
    }

    const token = await res.text();

    if (!token || !token.trim()) {
      return null;
    }

    return token;
  } catch (err) {
    console.error("Error fetching token from backend:", err);
    return null;
  }
}
export async function exchangeGithubCodeForToken(
  code: string,
  cookies?: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_API_PATH}/github/oauth-callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ code }),
    });

    const data = ((await res.json()) as { token: string }) || null;
    return data?.token || null;
  } catch (error) {
    console.error("Error exchanging code for token:", error);
    return null;
  }
}
export async function translateQuestion(
  assignmentId: number,
  questionId: number,
  question: QuestionStore,
  selectedLanguage: string,
  selectedLanguageCode: string,
  cookies?: string,
): Promise<{ translatedQuestion: string; translatedChoices?: Choice[] }> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/questions/${questionId}/translations`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({
        selectedLanguage,
        selectedLanguageCode,
        question,
      }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to translate question");
    }

    return (await res.json()) as {
      translatedQuestion: string;
      translatedChoices?: Choice[];
    };
  } catch (err) {
    console.error(err);
    throw err; // Ensure errors are handled appropriately in the UI
  }
}

export async function submitReportLearner(
  assignmentId: number,
  attemptId: number,
  issueType: REPORT_TYPE,
  description: string,
  cookies?: string,
): Promise<{ success: boolean } | undefined> {
  try {
    const response:
      | Response
      | {
          status: number;
          message: string;
        } = await fetch(
      `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts/${attemptId}/report`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: JSON.stringify({
          issueType,
          description,
        }),
      },
    );

    if (response.status === 422) {
      throw new Error(
        "You have reached the maximum number of reports allowed in a 24-hour period.",
      );
    } else if (!response.ok) {
      throw new Error("Failed to submit report");
    }

    return (await response.json()) as { success: boolean };
  } catch (error: unknown) {
    if (error instanceof Error) {
      toast.error(error.message);
    } else {
      toast.error("Failed to submit report");
    }
  }
}
