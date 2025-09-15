/*eslint-disable*/
/**
 * API functions specific to learners
 */
import { getApiRoutes } from "@/config/constants";
import type {
  AssignmentAttempt,
  AssignmentAttemptWithQuestions,
  AssignmentFeedback,
  BaseBackendResponse,
  LiveRecordingData,
  QuestionAttemptRequest,
  QuestionAttemptRequestWithId,
  QuestionAttemptResponse,
  QuestionStore,
  RegradingRequest,
  ReplaceAssignmentRequest,
  REPORT_TYPE,
  SubmitAssignmentResponse,
} from "@config/types";
import { toast } from "sonner";

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
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts`;
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
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}?lang=${language}`;

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
    return undefined;
  }
}

/**
 * gets the questions for a given completed attempt and assignment
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
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/completed`;

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
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/questions/${questionId}/responses`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },

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
    return undefined;
  }
}

/**
 * Get live recording feedback
 */
export async function getLiveRecordingFeedback(
  assignmentId: number,
  liveRecordingData: LiveRecordingData,
  cookies?: string,
): Promise<{ feedback: string }> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions/live-recording-feedback`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      body: JSON.stringify({ liveRecordingData }),
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(
        errorBody.message || "Failed to fetch live recording feedback",
      );
    }

    const data = (await res.json()) as {
      feedback: string;
    };
    return data;
  } catch (err) {
    return undefined;
  }
}

/**
 * Submits an assignment with progress tracking
 */
export async function submitAssignment(
  assignmentId: number,
  attemptId: number,
  responsesForQuestions: QuestionAttemptRequestWithId[],
  language?: string,
  authorQuestions?: QuestionStore[],
  authorAssignmentDetails?: ReplaceAssignmentRequest,
  cookies?: string,
  onProgress?: (
    status: "processing" | "completed" | "failed",
    progress: number,
    message: string,
  ) => void,
): Promise<SubmitAssignmentResponse | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}`;

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
      let errorMessage = `Submission failed with status: ${res.status}`;

      try {
        const errorBody = (await res.json()) as { message?: string };
        if (errorBody.message) {
          errorMessage = errorBody.message;
          if (
            errorMessage.includes("maximum context length") ||
            errorMessage.includes("tokens")
          ) {
            errorMessage =
              "Your submission is too long. Please reduce the length of your responses and try again.";
          }
        }
        console.error("Submission error:", errorBody);
        toast.error(errorMessage);
      } catch (parseError) {
        console.error("Failed to parse error response:", parseError);
      }

      throw new Error(errorMessage);
    }

    const responseData = (await res.json()) as SubmitAssignmentResponse;

    const { gradingJobId, message } = responseData;

    if (!gradingJobId) {
      throw new Error("No grading job ID returned");
    }

    const sseUrl = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/grading/${gradingJobId}/status-stream`;

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(sseUrl, {
        withCredentials: true,
      });

      let timeout: NodeJS.Timeout;
      let isCompleted = false;

      const resetTimeout = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (!isCompleted) {
            eventSource.close();
            onProgress?.("failed", 0, "Grading timeout - no updates received");
            reject(new Error("Grading timeout - no updates received"));
          }
        }, 300000); // 5 minutes
      };

      resetTimeout();

      eventSource.onopen = () => {
        onProgress?.("processing", 0, "Connected to grading service...");
      };

      eventSource.onmessage = (event) => {
        resetTimeout();

        try {
          const data = JSON.parse(event.data);

          if (data.status === "Processing" || data.status === "Pending") {
            const percentage = data.percentage || 0;
            const progress = data.progress || "Processing...";
            onProgress?.("processing", percentage, progress);
          } else if (data.status === "Completed" && !isCompleted) {
            isCompleted = true;
            onProgress?.("completed", 100, "Grading completed successfully!");

            eventSource.close();
            clearTimeout(timeout);

            let result = data.result;
            if (typeof result === "string") {
              try {
                result = JSON.parse(result);
              } catch (e) {
                console.error("Failed to parse result:", e);
              }
            }
            resolve(result);
          } else if (data.status === "Failed" && !isCompleted) {
            isCompleted = true;
            console.error("Grading failed:", data.progress);
            onProgress?.("failed", 0, data.progress || "Grading failed");

            eventSource.close();
            clearTimeout(timeout);

            setTimeout(() => {
              toast.error(data.progress || "Grading failed");
              reject(new Error(data.progress || "Grading failed"));
            }, 2000);
          }
        } catch (error) {
          console.error("Error parsing SSE data:", error);
        }
      };

      eventSource.addEventListener("update", (event: any) => {
        if (!isCompleted) {
          resetTimeout();
          try {
            const data = JSON.parse(event.data);

            if (data.progress && data.percentage !== undefined) {
              onProgress?.("processing", data.percentage, data.progress);
            }
          } catch (error) {
            console.error("Error parsing update event:", error);
          }
        }
      });

      eventSource.addEventListener("finalize", (event: any) => {
        if (!isCompleted) {
          try {
            isCompleted = true;
            const data = JSON.parse(event.data);
            onProgress?.("completed", 100, "Grading completed successfully!");

            eventSource.close();
            clearTimeout(timeout);

            let result = data.result;
            if (typeof result === "string") {
              try {
                result = JSON.parse(result);
              } catch (e) {
                console.error("Failed to parse result:", e);
              }
            }
            resolve(result);
          } catch (error) {
            console.error("Error in finalize event:", error);
            reject(error);
          }
        }
      });

      eventSource.onerror = (error) => {
        if (!isCompleted) {
          console.error("SSE error:", error);
          eventSource.close();
          clearTimeout(timeout);

          if (eventSource.readyState === EventSource.CLOSED) {
            onProgress?.("failed", 0, "Lost connection to grading service");
            toast.error("Lost connection to grading service");
            reject(new Error("Connection to grading service lost"));
          } else {
            reject(new Error("Grading stream error"));
          }
        } else {
          eventSource.close();
        }
      };
    });
  } catch (err) {
    console.error("Submit assignment error:", err);

    if (err instanceof Error) {
      throw err;
    }

    throw new Error("An unexpected error occurred during submission");
  }
}
/**
 * Get feedback for an assignment attempt
 */
export async function getFeedback(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
): Promise<AssignmentFeedback | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/feedback`;

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
    return undefined;
  }
}

/**
 * Submit feedback for an assignment attempt
 */
export async function submitFeedback(
  assignmentId: number,
  attemptId: number,
  feedback: AssignmentFeedback,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/feedback`;

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
    return false;
  }
}

/**
 * Submit a regrading request
 */
export async function submitRegradingRequest(
  regradingRequest: RegradingRequest,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().assignments}/${regradingRequest.assignmentId}/attempts/${regradingRequest.attemptId}/regrade`;
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
    return false;
  }
}

/**
 * Submit a report from a learner
 */
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
      `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/report`,
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

// =============================================================================
// VERSION CONTROL API FUNCTIONS (Learner Read-Only Access)
// =============================================================================

export interface VersionSummary {
  id: number;
  versionNumber: string;
  versionDescription?: string;
  isDraft: boolean;
  isActive: boolean;
  published: boolean;
  createdBy: string;
  createdAt: string;
  questionCount: number;
}

/**
 * Gets the current active version of an assignment (for learners)
 * @param assignmentId The assignment ID
 * @param cookies Optional cookies for authentication
 * @returns Assignment version data or undefined on error
 */
export async function getCurrentAssignmentVersion(
  assignmentId: number,
  cookies?: string,
): Promise<any | undefined> {
  try {
    // Learners access assignments through the regular assignment endpoint
    // which automatically returns the current active version
    const endpointURL = `${getApiRoutes().assignments}/${assignmentId}`;

    const res = await fetch(endpointURL, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to fetch assignment");
    }

    return await res.json();
  } catch (err) {
    console.error("Error fetching current assignment version:", err);
    return undefined;
  }
}

/**
 * Gets version information for an assignment (learner view)
 * This only returns published, non-draft versions that learners can see
 * @param assignmentId The assignment ID
 * @param cookies Optional cookies for authentication
 * @returns Limited version info or undefined on error
 */
export async function getAssignmentVersionInfo(
  assignmentId: number,
  cookies?: string,
): Promise<
  { currentVersion?: VersionSummary; totalVersions: number } | undefined
> {
  try {
    // This would be a learner-specific endpoint if we want to show version info
    // For now, we'll return basic info from the assignment endpoint
    const assignment = await getCurrentAssignmentVersion(assignmentId, cookies);

    if (assignment) {
      return {
        currentVersion: assignment.currentVersion,
        totalVersions: assignment.totalVersions || 1,
      };
    }

    return undefined;
  } catch (err) {
    console.error("Error fetching assignment version info:", err);
    return undefined;
  }
}
