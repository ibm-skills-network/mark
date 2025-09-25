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
  userId: string;
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
          3000000,
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

// =============================================================================
// VERSION CONTROL API FUNCTIONS
// =============================================================================

export interface VersionSummary {
  id: number;
  versionNumber?: string;
  versionDescription?: string;
  isDraft?: boolean;
  isActive?: boolean;
  published?: boolean;
  createdBy?: string;
  createdAt: string;
  questionCount: number;
  wasAutoIncremented?: boolean;
  originalVersionNumber?: number;
}

export interface CreateVersionRequest {
  versionNumber?: string;
  versionDescription?: string;
  isDraft?: boolean;
  shouldActivate?: boolean;
  updateExisting?: boolean;
  versionId?: number; // ID of the version to update when updateExisting is true
}

export interface CreateDraftVersionRequest {
  assignmentData: Record<string, any>;
  questionsData?: Array<any>;
  versionNumber: string;
  versionDescription?: string;
}

export interface CompareVersionsRequest {
  fromVersionId: number;
  toVersionId: number;
}

export interface RestoreVersionRequest {
  createAsNewVersion?: boolean;
  versionDescription?: string;
}

export interface SaveDraftRequest {
  versionNumber?: string;
  versionDescription?: string;
  assignmentData: Record<string, any>;
  questionsData?: Array<any>;
}

export interface DraftSummary {
  id: number;
  draftName: string;
  assignmentName: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
  published: boolean;
}

export interface VersionComparison {
  fromVersion: VersionSummary;
  toVersion: VersionSummary;
  assignmentChanges: Array<{
    field: string;
    fromValue: any;
    toValue: any;
    changeType: "added" | "modified" | "removed";
  }>;
  questionChanges: Array<{
    questionId?: number;
    displayOrder: number;
    changeType: "added" | "modified" | "removed";
    field?: string;
    fromValue?: any;
    toValue?: any;
  }>;
}
/**
 * Deletes a specific version
 * @param assignmentId The assignment ID
 * @param versionId The version ID to delete
 * @param cookies Optional cookies for authentication
 * @returns Success status or throws error
 */
export async function deleteVersion(
  assignmentId: number,
  versionId: number,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/${versionId}`;
  const res = await fetch(endpointURL, {
    method: "DELETE",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `HTTP ${res.status}: ${errorText || "Failed to delete version"}`,
    );
  }

  return true;
}
/**
 * Creates a new version of an assignment
 * @param assignmentId The assignment ID
 * @param versionData Version creation parameters
 * @param cookies Optional cookies for authentication
 * @returns Version summary or undefined on error
 */
export async function createAssignmentVersion(
  assignmentId: number,
  versionData: CreateVersionRequest,
  cookies?: string,
): Promise<VersionSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(versionData),
    });

    if (!res.ok) {
      const errorBody = await res.json();

      // For conflict errors (409), include the full response data
      if (res.status === 409) {
        const error = new Error(errorBody.message || "Version conflict");
        (error as any).response = { status: res.status, data: errorBody };
        throw error;
      }

      throw new Error(errorBody.message || "Failed to create version");
    }

    return (await res.json()) as VersionSummary;
  } catch (err: any) {
    console.error("Error creating assignment version:", err);
    // Re-throw error with response data intact for proper handling
    if (err.response) {
      throw err;
    }
    throw new Error("Failed to create version");
  }
}

/**
 * Lists all versions of an assignment
 * @param assignmentId The assignment ID
 * @param cookies Optional cookies for authentication
 * @returns Array of version summaries or empty array on error
 */
export async function listAssignmentVersions(
  assignmentId: number,
  cookies?: string,
): Promise<VersionSummary[]> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions`;
  try {
    const res = await fetch(endpointURL, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("❌ API Error Response:", res.status, errorText);
      try {
        const errorBody = JSON.parse(errorText);
        throw new Error(errorBody.message || "Failed to fetch versions");
      } catch {
        throw new Error(
          `HTTP ${res.status}: ${errorText || "Failed to fetch versions"}`,
        );
      }
    }

    const data = await res.json();
    return data as VersionSummary[];
  } catch (err) {
    console.error("💥 Error fetching assignment versions:", err);
    return [];
  }
}

/**
 * Gets the full data for a specific version of an assignment
 * @param assignmentId The assignment ID
 * @param versionId The version ID
 * @param cookies Optional cookies for authentication
 * @returns Full assignment version data or undefined on error
 */
export async function getAssignmentVersion(
  assignmentId: number,
  versionId: number,
  cookies?: string,
): Promise<any> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/${versionId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("❌ Get version API error:", res.status, errorText);
      try {
        const errorBody = JSON.parse(errorText);
        throw new Error(errorBody.message || "Failed to get version data");
      } catch {
        throw new Error(
          `HTTP ${res.status}: ${errorText || "Failed to get version data"}`,
        );
      }
    }

    const versionData = await res.json();
    return versionData;
  } catch (err) {
    console.error("💥 Error getting assignment version:", err);
    return undefined;
  }
}

/**
 * Saves assignment changes as a draft
 * @param assignmentId The assignment ID
 * @param draftData Draft data to save
 * @param cookies Optional cookies for authentication
 * @returns Draft summary or undefined on error
 */
export async function saveDraft(
  assignmentId: number,
  draftData: SaveDraftRequest,
  cookies?: string,
): Promise<DraftSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/drafts`;
  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(draftData),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to save draft");
    }

    return (await res.json()) as DraftSummary;
  } catch (err) {
    console.error("Error saving draft:", err);
    return undefined;
  }
}

/**
 * Updates an existing draft
 * @param assignmentId The assignment ID
 * @param draftId The draft ID to update
 * @param draftData Draft data to save
 * @param cookies Optional cookies for authentication
 * @returns Draft summary or undefined on error
 */
export async function updateDraft(
  assignmentId: number,
  draftId: number,
  draftData: SaveDraftRequest,
  cookies?: string,
): Promise<DraftSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/drafts/${draftId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(draftData),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to update draft");
    }

    return (await res.json()) as DraftSummary;
  } catch (err) {
    console.error("Error updating draft:", err);
    return undefined;
  }
}

/**
 * Lists all user drafts for an assignment
 * @param assignmentId The assignment ID
 * @param cookies Optional cookies for authentication
 * @returns Array of draft summaries or empty array on error
 */
export async function listUserDrafts(
  assignmentId: number,
  cookies?: string,
): Promise<DraftSummary[]> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/drafts`;

  try {
    const res = await fetch(endpointURL, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to list drafts");
    }

    return (await res.json()) as DraftSummary[];
  } catch (err) {
    console.error("Error listing drafts:", err);
    return [];
  }
}

/**
 * Gets user's latest draft for an assignment
 * @param assignmentId The assignment ID
 * @param cookies Optional cookies for authentication
 * @returns Latest draft data or null if no draft found
 */
export async function getLatestDraft(
  assignmentId: number,
  cookies?: string,
): Promise<any> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/drafts/latest`;

  try {
    const res = await fetch(endpointURL, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return null; // No draft found
      }
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to get latest draft");
    }

    return await res.json();
  } catch (err) {
    console.error("Error getting latest draft:", err);
    return null;
  }
}

/**
 * Gets a specific draft
 * @param assignmentId The assignment ID
 * @param draftId The draft ID
 * @param cookies Optional cookies for authentication
 * @returns Draft data or undefined on error
 */
export async function getDraft(
  assignmentId: number,
  draftId: number,
  cookies?: string,
): Promise<any> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/drafts/${draftId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to get draft");
    }

    return await res.json();
  } catch (err) {
    console.error("Error getting draft:", err);
    return undefined;
  }
}

/**
 * Deletes a draft
 * @param assignmentId The assignment ID
 * @param draftId The draft ID
 * @param cookies Optional cookies for authentication
 * @returns True if successful, false otherwise
 */
export async function deleteDraft(
  assignmentId: number,
  draftId: number,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/drafts/${draftId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to delete draft");
    }

    return true;
  } catch (err) {
    console.error("Error deleting draft:", err);
    return false;
  }
}

/**
 * Auto-saves assignment changes (for server-side temporary saving)
 * @param assignmentId The assignment ID
 * @param autoSaveData Data to auto-save
 * @param cookies Optional cookies for authentication
 * @returns Version summary or undefined on error
 */
export async function autoSaveAssignment(
  assignmentId: number,
  autoSaveData: { assignmentData: any; questionsData?: any[] },
  cookies?: string,
): Promise<VersionSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/auto-save`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(autoSaveData),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to auto-save");
    }

    return (await res.json()) as VersionSummary;
  } catch (err) {
    console.error("Error auto-saving assignment:", err);
    return undefined;
  }
}

/**
 * Restores an assignment to a specific version
 * @param assignmentId The assignment ID
 * @param versionId The version ID to restore
 * @param restoreOptions Restore configuration options
 * @param cookies Optional cookies for authentication
 * @returns Version summary or undefined on error
 */
export async function restoreAssignmentVersion(
  assignmentId: number,
  versionId: number,
  restoreOptions: RestoreVersionRequest = {},
  cookies?: string,
): Promise<VersionSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/${versionId}/restore`;

  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(restoreOptions),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to restore version");
    }

    return (await res.json()) as VersionSummary;
  } catch (err) {
    console.error("Error restoring assignment version:", err);
    return undefined;
  }
}

/**
 * Activates a specific version as the current version
 * @param assignmentId The assignment ID
 * @param versionId The version ID to activate
 * @param cookies Optional cookies for authentication
 * @returns Version summary or undefined on error
 */
export async function activateAssignmentVersion(
  assignmentId: number,
  versionId: number,
  cookies?: string,
): Promise<VersionSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/${versionId}/activate`;

  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to activate version");
    }

    return (await res.json()) as VersionSummary;
  } catch (err) {
    console.error("Error activating assignment version:", err);
    return undefined;
  }
}

/**
 * Publishes a specific version by setting its published field to true
 */
export async function publishVersionById(
  assignmentId: number,
  versionId: number,
  cookies?: string,
): Promise<VersionSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/${versionId}/publish`;

  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to publish version");
    }

    return (await res.json()) as VersionSummary;
  } catch (err) {
    console.error("Error publishing version:", err);
    return undefined;
  }
}

/**
 * Compares two versions of an assignment
 * @param assignmentId The assignment ID
 * @param compareData Version comparison parameters
 * @param cookies Optional cookies for authentication
 * @returns Version comparison or undefined on error
 */
export async function compareAssignmentVersions(
  assignmentId: number,
  compareData: CompareVersionsRequest,
  cookies?: string,
): Promise<VersionComparison | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/compare`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(compareData),
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to compare versions");
    }

    return (await res.json()) as VersionComparison;
  } catch (err) {
    console.error("Error comparing assignment versions:", err);
    return undefined;
  }
}

/**
 * Gets version history for an assignment
 * @param assignmentId The assignment ID
 * @param cookies Optional cookies for authentication
 * @returns Version history or empty array on error
 */
export async function getAssignmentVersionHistory(
  assignmentId: number,
  cookies?: string,
): Promise<any[]> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/history`;

  try {
    const res = await fetch(endpointURL, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch version history");
    }

    return (await res.json()) as any[];
  } catch (err) {
    console.error("Error fetching version history:", err);
    return [];
  }
}

/**
 * Gets the user's latest draft version of an assignment
 * @param assignmentId The assignment ID
 * @param cookies Optional cookies for authentication
 * @returns Latest draft data or null if no draft exists
 */
export async function getUserLatestDraft(
  assignmentId: number,
  cookies?: string,
): Promise<any> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/draft/latest`;

  try {
    const res = await fetch(endpointURL, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return null; // No draft found
      }
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch latest draft");
    }

    return await res.json();
  } catch (err) {
    console.error("Error fetching latest draft:", err);
    return null;
  }
}

/**
 * Updates a version description
 */
export async function updateVersionDescription(
  assignmentId: number,
  versionId: number,
  versionDescription: string,
  cookies?: string,
): Promise<VersionSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/${versionId}/description`;

  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ versionDescription }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `HTTP ${res.status}: ${errorText || "Failed to update version description"}`,
      );
    }

    return (await res.json()) as VersionSummary;
  } catch (err) {
    console.error("Error updating version description:", err);
    return undefined;
  }
}

/**
 * Create a draft version with assignment and questions data
 * @param assignmentId The assignment ID
 * @param draftData Draft version data including questions
 * @param cookies Optional cookies for authentication
 * @returns Version summary or undefined on error
 */
export async function createDraftVersion(
  assignmentId: number,
  draftData: CreateDraftVersionRequest,
  cookies?: string,
): Promise<VersionSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/draft`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(draftData),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `HTTP ${res.status}: ${errorText || "Failed to create draft version"}`,
      );
    }

    return (await res.json()) as VersionSummary;
  } catch (err) {
    console.error("Error creating draft version:", err);
    return undefined;
  }
}

/**
 * Updates a version number
 * @param assignmentId The assignment ID
 * @param versionId The version ID to update
 * @param newVersionNumber The new version number
 * @param cookies Optional cookies for authentication
 * @returns Success status or throws error
 */
export async function updateVersionNumber(
  assignmentId: number,
  versionId: number,
  newVersionNumber: string,
  cookies?: string,
): Promise<VersionSummary | undefined> {
  const endpointURL = `${getApiRoutes().versions}/${assignmentId}/versions/${versionId}/version-number`;

  try {
    const res = await fetch(endpointURL, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify({ versionNumber: newVersionNumber }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `HTTP ${res.status}: ${errorText || "Failed to update version number"}`,
      );
    }

    return (await res.json()) as VersionSummary;
  } catch (err) {
    console.error("Error updating version number:", err);
    throw err;
  }
}
