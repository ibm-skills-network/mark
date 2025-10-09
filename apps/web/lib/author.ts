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
import { apiClient } from "./api-client";

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
 * Calls the backend to modify an assignment.
 */
export async function replaceAssignment(
  data: ReplaceAssignmentRequest,
  id: number,
  cookies?: string,
): Promise<boolean> {
  try {
    const response = await apiClient.put(
      getApiRoutes().assignments + `/${id}`,
      data,
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
    const { success, error } = response as BaseBackendResponse;
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
    const response = await apiClient.patch(
      getApiRoutes().assignments + `/${id}`,
      data,
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
    const { success, error } = response as BaseBackendResponse;
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
    const response = await apiClient.post(endpointURL, question, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    const { success, error, id } = response as BaseBackendResponse;
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
    const { jobId, message } = (await apiClient.put(endpointURL, payload, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as {
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
    const { success, error, id } = (await apiClient.put(endpointURL, question, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as BaseBackendResponse;
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
    const { success, error, questions } = (await apiClient.post(
      endpointURL,
      {
        questions: questionsFromFrontend,
        questionVariationNumber,
      },
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    )) as BaseBackendResponse & {
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
    const rubric = (await apiClient.post(
      endpointURL,
      { question, rubricIndex },
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    )) as Scoring | Choice[];
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
    const rubric = (await apiClient.post(
      endpointURL,
      { question },
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    )) as QuestionAuthorStore;
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
    const { success, error } = (await apiClient.delete(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as BaseBackendResponse;
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
    const attempts = (await apiClient.get(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as AssignmentAttempt[];
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

  try {
    const data = (await apiClient.post(
      endpointURL,
      { ...payload },
      {
        headers: {
          Connection: "keep-alive",
          KeepAlive: "timeout=1000000",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    )) as {
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
  const { retries = 2 } = opts;
  const endpointURL = `${getApiRoutes().assignments}/jobs/${jobId}/status`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return (await apiClient.get(endpointURL, {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      })) as {
        status: string;
        progress: string;
        progressPercentage: string;
        questions?: QuestionAuthorStore[];
      };
    } catch (err) {
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
    return (await apiClient.post(
      `${getApiRoutes().assignments}/${assignmentId}/report`,
      {
        issueType,
        description,
      },
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    )) as { success: boolean };
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

  await apiClient.delete(endpointURL, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

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
    return (await apiClient.post(endpointURL, versionData, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as VersionSummary;
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
    const data = (await apiClient.get(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as VersionSummary[];
    return data;
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
    const versionData = await apiClient.get(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
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
    return (await apiClient.post(endpointURL, draftData, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as DraftSummary;
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
    return (await apiClient.put(endpointURL, draftData, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as DraftSummary;
  } catch (err) {
    console.error("Error updating draft:", err);
    return undefined;
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
    return await apiClient.get(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
  } catch (err: any) {
    if (err.status === 404) {
      return null; // No draft found
    }
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
    return await apiClient.get(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
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
    await apiClient.delete(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

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
    return (await apiClient.post(endpointURL, autoSaveData, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as VersionSummary;
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
    return (await apiClient.put(endpointURL, restoreOptions, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as VersionSummary;
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
    return (await apiClient.put(
      endpointURL,
      {},
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    )) as VersionSummary;
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
    return (await apiClient.put(
      endpointURL,
      {},
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    )) as VersionSummary;
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
    return (await apiClient.post(endpointURL, compareData, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as VersionComparison;
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
    return (await apiClient.get(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as any[];
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
    return await apiClient.get(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
  } catch (err: any) {
    if (err.status === 404) {
      return null; // No draft found
    }
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
    return (await apiClient.put(
      endpointURL,
      { versionDescription },
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    )) as VersionSummary;
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
    return (await apiClient.post(endpointURL, draftData, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    })) as VersionSummary;
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
    return (await apiClient.put(
      endpointURL,
      { versionNumber: newVersionNumber },
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    )) as VersionSummary;
  } catch (err) {
    console.error("Error updating version number:", err);
    throw err;
  }
}
