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
import { submitReportAuthor } from "@/lib/talkToBackend";
import { apiClient, APIError } from "./api-client";
import { normalizeAttemptTimestamps } from "@/app/learner/utils/attempts";

/**
 * Creates a attempt for a given assignment.
 * @param assignmentId The id of the assignment to create the attempt for.
 * @returns The id of the created attempt.
 * @throws An error if the request fails.
 */
export async function createAttempt(
  assignmentId: number,
  cookies?: string,
): Promise<number | undefined | "no more attempts" | "in cooldown period"> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts`;
  try {
    const res = await apiClient.post<BaseBackendResponse>(
      endpointURL,
      undefined,
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
    console.log("result: ", res);
    const { success, error, id } = res;
    if (!success) {
      throw new Error(error);
    }

    return id;
  } catch (err) {
    if (err instanceof APIError && err.status === 422) {
      return "no more attempts";
    } else if (err instanceof APIError && err.status === 429) {
      return "in cooldown period";
    }
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
    const attempt = await apiClient.get<AssignmentAttemptWithQuestions>(
      endpointURL,
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
    if (!attempt) {
      return undefined;
    }

    const fallbackAllotedMinutes =
      attempt.assignmentVersion?.allotedTimeMinutes ??
      attempt.assignmentDetails?.allotedTimeMinutes ??
      attempt.assignment?.allotedTimeMinutes ??
      null;

    return normalizeAttemptTimestamps(attempt, fallbackAllotedMinutes);
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
    const attempt = await apiClient.get<AssignmentAttemptWithQuestions>(
      endpointURL,
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
    if (!attempt) {
      return undefined;
    }

    const fallbackAllotedMinutes =
      attempt.assignmentVersion?.allotedTimeMinutes ??
      attempt.assignmentDetails?.allotedTimeMinutes ??
      attempt.assignment?.allotedTimeMinutes ??
      null;

    return normalizeAttemptTimestamps(attempt, fallbackAllotedMinutes);
  } catch (err) {
    return undefined;
  }
}

/**
 * Gets unified success page data for an attempt (works for both authors and learners).
 * @param assignmentId The id of the assignment.
 * @param attemptId The id of the attempt.
 * @param authorData Optional author data from Zustand stores (for authors only).
 * @param cookies Optional cookies for authentication.
 * @returns Success page data or undefined if error.
 */
export async function getSuccessPageData(
  assignmentId: number,
  attemptId: number,
  authorData?: {
    questions: any[];
    grade: number;
    totalPointsEarned: number;
    totalPointsPossible: number;
    responses: any[];
  },
  cookies?: string,
): Promise<any | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/success-page-data`;

  try {
    const data = await apiClient.post(endpointURL, authorData || {}, {
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    return data;
  } catch (err) {
    console.error("Error fetching success page data:", err);
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
    const processedBody = JSON.parse(
      JSON.stringify(requestBody, (key, value) => {
        if (value === "" || value === null || value === undefined) {
          return undefined;
        }
        return value;
      }),
    );

    const data = await apiClient.post<QuestionAttemptResponse>(
      endpointURL,
      processedBody,
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
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
    const data = await apiClient.post<{ feedback: string }>(
      endpointURL,
      { liveRecordingData },
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
    return data;
  } catch (err) {
    return { feedback: "" };
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
    const requestData = {
      submitted: true,
      responsesForQuestions,
      language,
      authorQuestions: authorQuestions || undefined,
      authorAssignmentDetails: authorAssignmentDetails || undefined,
    };

    let responseData: SubmitAssignmentResponse;
    try {
      responseData = await apiClient.patch<SubmitAssignmentResponse>(
        endpointURL,
        requestData,
        {
          headers: {
            "Content-Type": "application/json",
            ...(cookies ? { Cookie: cookies } : {}),
          },
        },
      );
    } catch (apiError) {
      let errorMessage = "Submission failed";

      if (apiError instanceof APIError) {
        errorMessage = `Submission failed with status: ${apiError.status}`;

        if (
          apiError.message.includes("maximum context length") ||
          apiError.message.includes("tokens")
        ) {
          errorMessage =
            "Your submission is too long. Please reduce the length of your responses and try again.";
        } else if (apiError.message) {
          errorMessage = apiError.message;
        }
      }

      console.error("Submission error:", apiError);
      toast.error(errorMessage);
      throw new Error(errorMessage);
    }

    const { gradingJobId, message } = responseData;

    if (!gradingJobId) {
      throw new Error("No grading job ID returned");
    }

    const sseUrl = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/grading/${gradingJobId}/status-stream`;

    return new Promise((resolve, reject) => {
      let retryCount = 0;
      const maxRetries = 3;
      let allErrors: Array<{
        attempt: number;
        error: string;
        timestamp: string;
        readyState?: number;
        url?: string;
      }> = [];

      const attemptConnection = () => {
        retryCount++;
        const currentAttempt = retryCount;

        console.log(`SSE Connection attempt ${currentAttempt}/${maxRetries}`);

        const eventSource = new EventSource(sseUrl, {
          withCredentials: true,
        });

        let timeout: NodeJS.Timeout;
        let isCompleted = false;

        const resetTimeout = () => {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => {
            if (!isCompleted) {
              const timeoutError = "Grading timeout - no updates received";
              allErrors.push({
                attempt: currentAttempt,
                error: timeoutError,
                timestamp: new Date().toISOString(),
                readyState: eventSource.readyState,
                url: sseUrl,
              });

              eventSource.close();
              onProgress?.("failed", 0, timeoutError);

              if (currentAttempt < maxRetries) {
                setTimeout(() => attemptConnection(), 2000 * currentAttempt); // Progressive delay
              } else {
                handleFinalFailure();
              }
            }
          }, 300000); // 5 minutes
        };

        resetTimeout();

        eventSource.onopen = () => {
          console.log(`SSE connection opened on attempt ${currentAttempt}`);
          onProgress?.(
            "processing",
            0,
            `Connected to grading service... (attempt ${currentAttempt})`,
          );
        };

        eventSource.onmessage = (event) => {
          resetTimeout();

          try {
            let data;
            try {
              data = JSON.parse(event.data);
            } catch (parseError) {
              // Handle non-JSON data (legacy format)
              data = event.data;
            }

            // Handle heartbeat messages
            if (data.heartbeat) {
              console.log(`Heartbeat received for grading job ${data.jobId}`);
              return;
            }

            // Handle connection messages
            if (data.message && data.connectionId) {
              onProgress?.("processing", 0, data.message);
              return;
            }

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

              // Handle heartbeat in update events
              if (data.heartbeat) {
                console.log(
                  `Heartbeat received via update event for job ${data.jobId}`,
                );
                return;
              }

              if (data.progress && data.percentage !== undefined) {
                onProgress?.("processing", data.percentage, data.progress);
              }
            } catch (error) {
              console.error("Error parsing update event:", error);
            }
          }
        });

        eventSource.addEventListener("heartbeat", (event: any) => {
          if (!isCompleted) {
            resetTimeout();
            try {
              const data = JSON.parse(event.data);
              console.log(`Heartbeat event received for job ${data.jobId}`);
              // Heartbeats don't need to update the UI, just reset the timeout
            } catch (error) {
              console.error("Error parsing heartbeat event:", error);
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
            const errorDetails = {
              attempt: currentAttempt,
              error:
                eventSource.readyState === EventSource.CLOSED
                  ? "Connection to grading service lost"
                  : "Grading stream error",
              timestamp: new Date().toISOString(),
              readyState: eventSource.readyState,
              url: sseUrl,
            };

            allErrors.push(errorDetails);
            console.error(
              `SSE error on attempt ${currentAttempt}:`,
              error,
              errorDetails,
            );

            eventSource.close();
            clearTimeout(timeout);

            if (currentAttempt < maxRetries) {
              const retryDelay = 2000 * currentAttempt; // Progressive delay: 2s, 4s, 6s
              onProgress?.(
                "failed",
                0,
                `Connection lost. Retrying in ${retryDelay / 1000} seconds... (attempt ${currentAttempt}/${maxRetries})`,
              );
              setTimeout(() => attemptConnection(), retryDelay);
            } else {
              handleFinalFailure();
            }
          } else {
            eventSource.close();
          }
        };
      };

      const handleFinalFailure = async () => {
        console.error("All SSE connection attempts failed:", allErrors);

        // Create detailed error report
        const detailedErrorReport = {
          assignmentId,
          attemptId,
          gradingJobId,
          sseUrl,
          totalAttempts: maxRetries,
          allErrors,
          finalFailureTime: new Date().toISOString(),
          userAgent: navigator.userAgent,
          url: window.location.href,
        };

        // Try to submit error report
        try {
          await submitReportLearner(
            assignmentId,
            attemptId,
            "TECHNICAL_ISSUE" as REPORT_TYPE,
            `SSE Connection Failed After ${maxRetries} Attempts\n\nDetailed Error Report:\n${JSON.stringify(detailedErrorReport, null, 2)}`,
            cookies,
          );
          console.log("Error report submitted successfully");
        } catch (reportError) {
          console.error("Failed to submit error report:", reportError);

          // Fallback: try author report
          try {
            await submitReportAuthor(
              assignmentId,
              "TECHNICAL_ISSUE" as REPORT_TYPE,
              `SSE Connection Failed - Learner Report Fallback\n\nAttempt ID: ${attemptId}\nError Details:\n${JSON.stringify(detailedErrorReport, null, 2)}`,
              cookies,
            );
            console.log("Fallback error report submitted successfully");
          } catch (fallbackError) {
            console.error("All error reporting methods failed:", fallbackError);
          }
        }

        // Final user notification
        const finalErrorMessage = `Connection failed after ${maxRetries} attempts. Error details have been automatically reported.`;
        onProgress?.("failed", 0, finalErrorMessage);
        toast.error(finalErrorMessage);
        reject(
          new Error(
            `SSE connection failed after ${maxRetries} attempts. Last error: ${allErrors[allErrors.length - 1]?.error || "Unknown error"}`,
          ),
        );
      };

      // Start the first connection attempt
      attemptConnection();
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
    const data = await apiClient.get<AssignmentFeedback>(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
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
    await apiClient.post(
      endpointURL,
      { feedback },
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

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
    await apiClient.post(
      endpointURL,
      { regradingRequest },
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

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
    const response = await apiClient.post<{ success: boolean }>(
      `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/report`,
      {
        issueType,
        description,
      },
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

    return response;
  } catch (error: unknown) {
    if (error instanceof APIError) {
      if (error.status === 422) {
        toast.error(
          "You have reached the maximum number of reports allowed in a 24-hour period.",
        );
      } else {
        toast.error("Failed to submit report");
      }
    } else if (error instanceof Error) {
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

    const assignment = await apiClient.get(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    return assignment;
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
