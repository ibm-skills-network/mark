/* eslint-disable */
/**
 * API functions specific to assignment authors
 */
import { getApiRoutes, getBaseApiPath } from "@/config/constants";
import type {
  AssignmentAttempt,
  BaseBackendResponse,
  Choice,
  CreateQuestionRequest,
  PublishJobResponse,
  Question,
  QuestionAuthorStore,
  QuestionGenerationPayload,
  ReplaceAssignmentRequest,
  REPORT_TYPE,
  Scoring,
} from "@config/types";
interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  metadata: string | null;
}
/**
 * Fetches user notifications from the backend.
 * @param userId The ID of the user to fetch notifications for
 * @param cookies Optional cookies string for authenticated requests
 * @returns An array of notifications or empty array on error
 */
export async function getUserNotifications(
  cookies?: string,
): Promise<Notification[]> {
  try {
    const res = await fetch(`${getBaseApiPath("v1")}/notifications/user`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = await res.json();
      throw new Error(errorBody.message || "Failed to fetch notifications");
    }

    return await res.json();
  } catch (err) {
    return [];
  }
}

/**
 * Fetches the count of unread notifications for a user.
 * @param userId The ID of the user to fetch unread count for
 * @param cookies Optional cookies string for authenticated requests
 * @returns Object containing the unread count or 0 on error
 */
export async function getUnreadNotificationCount(
  cookies?: string,
): Promise<{ count: number }> {
  try {
    const res = await fetch(
      `${getBaseApiPath("v1")}/notifications/user/unread`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

    if (!res.ok) {
      const errorBody = await res.json();
      throw new Error(
        errorBody.message || "Failed to fetch unread notification count",
      );
    }

    return await res.json();
  } catch (err) {
    return { count: 0 };
  }
}

/**
 * Marks a notification as read.
 * @param notificationId The ID of the notification to mark as read
 * @param cookies Optional cookies string for authenticated requests
 * @returns True if successful, false otherwise
 */
export async function markNotificationAsRead(
  notificationId: number,
  cookies?: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${getBaseApiPath("v1")}/notifications/mark-read/${notificationId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

    if (!res.ok) {
      const errorBody = await res.json();
      throw new Error(
        errorBody.message || "Failed to mark notification as read",
      );
    }

    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Marks all notifications for a user as read.
 * @param userId The ID of the user whose notifications should be marked as read
 * @param cookies Optional cookies string for authenticated requests
 * @returns True if successful, false otherwise
 */
export async function markAllNotificationsAsRead(
  userId: string,
  cookies?: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${getBaseApiPath("v1")}/notifications/mark-all-read/${userId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

    if (!res.ok) {
      const errorBody = await res.json();
      throw new Error(
        errorBody.message || "Failed to mark all notifications as read",
      );
    }

    return true;
  } catch (err) {
    return false;
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
    const res = await fetch(getApiRoutes().assignments + `/${id}`, {
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
    const res = await fetch(getApiRoutes().assignments + `/${id}`, {
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
    return false;
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
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions`;

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
    return undefined;
  }
}

/**
 * Subscribes to job status updates.
 */
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

    timeoutId = setTimeout(() => handleError("Connection timeout"), 30000);

    try {
      eventSource = new EventSource(
        `${
          getApiRoutes().assignments
        }/jobs/${jobId}/status-stream?_=${Date.now()}`,
        { withCredentials: true },
      );

      controller.signal.addEventListener("abort", () => {
        eventSource?.close();
      });

      eventSource.onopen = () => {
        clearTimeout(timeoutId);

        timeoutId = setTimeout(
          () => handleError("Job processing timeout"),
          300000,
        );
      };

      eventSource.addEventListener("update", (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as PublishJobResponse;

          if (data.percentage !== undefined && onProgress) {
            onProgress(data.percentage, data.progress);
          }

          if (data?.result) {
            receivedQuestions = JSON.parse(
              data.result,
            ) as QuestionAuthorStore[];
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

      eventSource.addEventListener(
        "finalize",
        (event: MessageEvent<string>) => {
          try {
            const data = JSON.parse(event.data) as PublishJobResponse;
            if (data.percentage !== undefined && onProgress) {
              onProgress(data.percentage, data.progress);
            }
            if (data?.result) {
              receivedQuestions = JSON.parse(
                data.result,
              ) as QuestionAuthorStore[];
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

      eventSource.addEventListener(
        "close",
        (event: MessageEvent<string>) => {},
      );

      eventSource.onerror = (err) => {
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

/**
 * Publishes an assignment.
 */
export async function publishAssignment(
  assignmentId: number,
  updatedAssignment: ReplaceAssignmentRequest,
  cookies?: string,
): Promise<{ jobId: number; message: string } | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/publish`;

  const payload = {
    ...updatedAssignment,
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

    const { jobId, message } = (await res.json()) as {
      jobId: number;
      message: string;
    };
    return { jobId, message };
  } catch (err) {}
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
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions/${questionId}`;

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
    return undefined;
  }
}

/**
 * Generates a variant of questions.
 */
export async function generateQuestionVariant(
  questionsFromFrontend: QuestionAuthorStore[],
  questionVariationNumber: number,
  assignmentId: number,
  cookies?: string,
): Promise<QuestionAuthorStore[] | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/question/generate-variant`;

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
    return undefined;
  }
}

/**
 * Generates a rubric for a question.
 */
export async function generateRubric(
  question: QuestionAuthorStore,
  assignmentId: number,
  rubricIndex?: number,
  cookies?: string,
): Promise<Scoring | Choice[]> {
  const endpointURL = `${getApiRoutes().rubric}/${assignmentId}/questions/create-marking-rubric`;
  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ question, rubricIndex }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to generate rubric");
    }
    const rubric = (await res.json()) as Scoring | Choice[];
    return rubric;
  } catch (err) {
    return undefined;
  }
}

/**
 * Expands a marking rubric.
 */
export async function expandMarkingRubric(
  question: QuestionAuthorStore,
  assignmentId: number,
  cookies?: string,
): Promise<QuestionAuthorStore> {
  const endpointURL = `${getApiRoutes().rubric}/${assignmentId}/questions/expand-marking-rubric`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ question }),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to generate rubric");
    }
    const rubric = (await res.json()) as QuestionAuthorStore;
    return rubric;
  } catch (err) {
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
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions/${questionId}`;

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
    return false;
  }
}

/**
 * Get a list of attempts for a given assignment (for authors).
 */
export async function getAttempts(
  assignmentId: number,
  cookies?: string,
): Promise<AssignmentAttempt[] | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts`;

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
    return undefined;
  }
}

/**
 * Upload files and generate questions based on them.
 */
export async function uploadFiles(
  payload: QuestionGenerationPayload,
  cookies?: string,
): Promise<{ success: boolean; jobId?: number }> {
  const endpointURL = `${getApiRoutes().assignments}/${payload.assignmentId}/generate-questions`;
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

    const data = (await res.json()) as {
      success: boolean;
      jobId?: number;
    };

    if (data.jobId) {
      return {
        success: true,
        jobId: data.jobId,
      };
    } else {
      return { success: false };
    }
  } catch (err) {
    return { success: false };
  }
}

/**
 * Fetches the status of a job by its ID.
 */
export async function getJobStatus(
  jobId: number,
  cookies?: string,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<
  | {
      status: string;
      progress: string;
      progressPercentage: string;
      questions?: QuestionAuthorStore[];
    }
  | undefined
> {
  const { retries = 2, timeoutMs = 10_000 } = opts;
  const endpointURL = `${getApiRoutes().assignments}/jobs/${jobId}/status`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const res = await fetch(endpointURL, {
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      });

      clearTimeout(timer);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      return (await res.json()) as {
        status: string;
        progress: string;
        progressPercentage: string;
        questions?: QuestionAuthorStore[];
      };
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) return undefined;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

/**
 * Submit report from an author
 */
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
      `${getApiRoutes().assignments}/${assignmentId}/report`,
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
      throw error;
    } else {
      throw new Error("Failed to submit report");
    }
  }
}
