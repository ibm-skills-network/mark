"use server";

import { revalidatePath } from "next/cache";

// eslint-disable-next-line @typescript-eslint/require-await
export async function revalidateQuestionsRoute() {
  revalidatePath("/learner/[assignmentId]/questions", "page");
}
