import fs from "fs";
import path from "path";

type AssignmentCache = {
  id: number;
  name?: string;
  type?: string;
  groupId?: string;
};

type AssignmentsCache = {
  learner: AssignmentCache;
  author: AssignmentCache;
};

export default async function globalSetup() {
  const cacheDir = path.resolve(__dirname, "../playwright/.cache");
  const cachePath = path.join(cacheDir, "assignments.json");

  // Load assignment IDs from cache
  if (fs.existsSync(cachePath)) {
    try {
      const cachedAssignments: AssignmentsCache = JSON.parse(
        fs.readFileSync(cachePath, "utf-8"),
      );

      if (cachedAssignments.learner?.id && cachedAssignments.author?.id) {
        process.env.PW_LEARNER_ASSIGNMENT_ID = String(
          cachedAssignments.learner.id,
        );
        process.env.PW_AUTHOR_ASSIGNMENT_ID = String(
          cachedAssignments.author.id,
        );

        console.log(`\nUsing cached test assignments:`);
        console.log(`  📚 Learner: ${cachedAssignments.learner.id}`);
        console.log(`  ✏️ Author: ${cachedAssignments.author.id}\n`);
        return;
      }
    } catch (error) {
      console.warn(`Warning: Could not read assignment cache:`, error);
    }
  }

  // No valid cache found
  console.error(`\n No test assignments found!`);
  console.error(`\nPlease run the setup script first:`);
  console.error(`  yarn test:setup\n`);
  console.error(
    `This will create test assignments and show you which assignment IDs`,
  );
  console.error(
    `to configure in the mock auth guard before starting your dev server.\n`,
  );

  throw new Error("Test assignments not found. Run 'yarn test:setup' first.");
}
