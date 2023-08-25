/**
 * This file is used to talk to the backend.
 */

import { BASE_API_ROUTES } from "@config/constants";
import type { Assignment, AssignmentBackendResponse } from "@config/types";

/**
 * Calls the backend to create an assignment.
 */
export async function createAssignment(
  data: Assignment
): Promise<number | undefined> {
  try {
    const res = await fetch(BASE_API_ROUTES.assignments, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error("Failed to create assignment");
    }
    const { success, id, error } =
      (await res.json()) as AssignmentBackendResponse;
    if (!success) {
      throw new Error(error);
    }
    return id;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}
