import { expect, test as base } from "@playwright/test";
import {
  readAssignmentsCache,
  type TestAssignments,
} from "./assignment-helpers";

type E2EFixtures = {
  assignmentIds: TestAssignments;
};

export const test = base.extend<E2EFixtures>({
  assignmentIds: [
    async ({}, use) => {
      await use(readAssignmentsCache());
    },
    { scope: "worker" },
  ],
});

export { expect };
