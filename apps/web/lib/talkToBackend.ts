/**
 * This file is used to talk to the backend.
 */
import { BASE_API_ROUTES } from "@config/constants";
import type {
  Assignment,
  AssignmentAttempt,
  AssignmentAttemptWithQuestions,
  BaseBackendResponse,
  CreateQuestionRequest,
  GetAssignmentResponse,
  QuestionAttemptRequest,
  QuestionAttemptRequestWithId,
  QuestionAttemptResponse,
  ReplaceAssignmentRequest,
  SubmitAssignmentResponse,
  User,
} from "@config/types";

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
    console.log("res", res);

    if (!res.ok) {
      throw new Error("Failed to fetch user data");
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
      throw new Error("Failed to replace assignment");
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
      throw new Error("Failed to update assignment");
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
  cookies?: string,
): Promise<Assignment | undefined> {
  try {
    const res = await fetch(BASE_API_ROUTES.assignments + `/${id}`, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch assignment");
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
      throw new Error("Failed to fetch assignments");
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
  console.log("cookie getAttempt: ", cookies);

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to call ${endpointURL} with ${res.status}: ${res.toString()}`,
      );
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
  console.log("endpointURL", endpointURL);
  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    console.log("res", res);

    if (!res.ok) {
      if (res.status === 422) {
        return "no more attempts";
      }
      throw new Error("Failed to create attempt");
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
 * gets the questions for a given attempt and assignment
 * @param assignmentId The id of the assignment to get the questions for.
 * @param attemptId The id of the attempt to get the questions for.
 * @returns An array of questions.
 * @throws An error if the request fails.
 */
export async function getAttempt(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
): Promise<AssignmentAttemptWithQuestions | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts/${attemptId}`;

  try {
    const res = await fetch(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!res.ok) {
      throw new Error("Failed to get attempt questions");
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
      throw new Error("Failed to submit answer");
    }
    const { id, feedback, totalPoints } =
      (await res.json()) as QuestionAttemptResponse;
    return { id, feedback, totalPoints };
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
  cookies?: string,
): Promise<SubmitAssignmentResponse | undefined> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/attempts/${attemptId}`;

  try {
    const res = await fetch(endpointURL, {
      method: "PATCH",
      body: JSON.stringify({ submitted: true, responsesForQuestions }),
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    if (!res.ok) {
      throw new Error("Failed to submit assignment");
    }
    const data = (await res.json()) as SubmitAssignmentResponse;
    return data;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}
