/**
 * This file is used to talk to the backend.
 */
import { BASE_API_ROUTES } from "@config/constants";
import type {
  Assignment,
  BaseBackendResponse,
  CreateQuestionRequest,
  GetAssignmentResponse,
  ModifyAssignmentRequest,
  QuestionResponse,
  User,
} from "@config/types";

/**
 * Calls the backend to see who the user is (author, learner, or admin).
 */
export async function getUser(): Promise<User | undefined> {
  try {
    const res = await fetch(BASE_API_ROUTES.user);

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
 * Calls the backend to create an assignment.
 */
export async function modifyAssignment(
  data: ModifyAssignmentRequest,
  id: number
): Promise<boolean> {
  try {
    //
    const res = await fetch(BASE_API_ROUTES.assignments + `/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error("Failed to create assignment");
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
  id: number
): Promise<Assignment | undefined> {
  try {
    const res = await fetch(BASE_API_ROUTES.assignments + `/${id}`);
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
export async function getAssignments(): Promise<Assignment[]> {
  try {
    const res = await fetch(BASE_API_ROUTES.assignments);
    if (!res.ok) {
      throw new Error("Failed to fetch assignments");
    }
    const assignments = (await res.json()) as Assignment[];
    return assignments;
  } catch (err) {
    console.error(err);
    return [];
  }
}

/**
 * Submits an answer (text or URL) for a given assignment, submission, and question.
 */
export async function submitTextOrURLAnswer(
  assignmentId: number,
  submissionID: number,
  questionId: number,
  responseBody: any
): Promise<boolean> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/submissions/${submissionID}/questions/${questionId}/responses`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responseBody),
    });

    if (!res.ok) {
      throw new Error("Failed to submit answer");
    }
    const { success, error } = await res.json();
    if (!success) {
      throw new Error(error);
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// talk to backend when submitting individual questions (Benny)
export async function submitQuestionResponse(
  assignmentId: number,
  submissionID: number,
  questionId: number,
  response: QuestionResponse
): Promise<boolean> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/submissions/${submissionID}/questions/${questionId}/responses`;

  try {
    let body;
    const headers = {};

    if (response.learnerFileResponse) {
      body = new FormData();
      body.append("learnerFileResponse", response.learnerFileResponse);
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(response);
    }

    const res = await fetch(endpointURL, {
      method: "POST",
      headers,
      body,
    });

    if (!res.ok) {
      throw new Error("Failed to submit response");
    }

    const result = await res.json();
    if (result.error) {
      throw new Error(result.error);
    }

    return true;
  } catch (err) {
    console.error(err);
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
  question: CreateQuestionRequest
): Promise<number> {
  const endpointURL = `${BASE_API_ROUTES.assignments}/${assignmentId}/questions`;

  try {
    const res = await fetch(endpointURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
    return -1;
  }
}
