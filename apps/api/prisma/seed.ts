import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import {
  ScoringType,
  type CreateUpdateQuestionRequestDto,
} from "../src/api/assignment/question/dto/create.update.question.request.dto";

const prisma = new PrismaClient();
// eslint-disable-next-line unicorn/prefer-module
dotenv.config({ path: path.join(__dirname, "../../../dev.env") });

const questions: CreateUpdateQuestionRequestDto[] = [
  {
    question:
      "[1] Provide the URL for your selected job listing for a Cybersecurity role you can see yourself applying for in the future.",
    type: "TEXT",
    maxWords: 100,
    totalPoints: 2,
    scoring: {
      type: ScoringType.CRITERIA_BASED,
      rubrics: [
        {
          rubricQuestion: "Did the learner provide a valid job listing URL?",
          criteria: [
            { description: "No, a valid URL was not provided.", points: 0 },
            { description: "Yes, a valid URL was provided.", points: 1 },
          ],
        },
      ],
    },
  },
  {
    question:
      "[2] Provide the following details from the selected Cybersecurity job posting: Company Name, Job Title, Job Location.",
    type: "TEXT",
    maxWords: 100,
    totalPoints: 2,
    scoring: {
      type: ScoringType.CRITERIA_BASED,
      rubrics: [
        {
          rubricQuestion: "Did the learner provide all required details?",
          criteria: [
            {
              description: "No, some or all required details were missing.",
              points: 0,
            },
            {
              description: "Yes, all required details were provided.",
              points: 1,
            },
          ],
        },
      ],
    },
  },
  {
    question:
      "[3] Provide at least 3 IT or cybersecurity skills required for the selected Cybersecurity job listing.",
    type: "TEXT",
    maxWords: 100,
    totalPoints: 2,
    scoring: {
      type: ScoringType.CRITERIA_BASED,
      rubrics: [
        {
          rubricQuestion:
            "Did the learner list at least 3 relevant IT or cybersecurity skills?",
          criteria: [
            {
              description:
                "No, fewer than 3 required skills were provided or they were not relevant.",
              points: 0,
            },
            {
              description:
                "Yes, at least 3 relevant IT or cybersecurity skills were provided.",
              points: 1,
            },
          ],
        },
      ],
    },
  },
  {
    question:
      "[4] Provide the following details from the selected Cybersecurity job listing: Education, Preferred Certifications, Experience/background.",
    type: "TEXT",
    maxWords: 100,
    totalPoints: 2,
    scoring: {
      type: ScoringType.CRITERIA_BASED,
      rubrics: [
        {
          rubricQuestion: "Did the learner provide all required details?",
          criteria: [
            {
              description: "No, some or all required details were missing.",
              points: 0,
            },
            {
              description: "Yes, all required details were provided.",
              points: 1,
            },
          ],
        },
      ],
    },
  },
];

async function runPgRestore(sqlFilePath: string) {
  const database = process.env.POSTGRES_DB;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD; // pragma: allowlist secret
  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT;
  const command = `PGPASSWORD=${password} pg_restore -d ${database} -U ${user} -h ${host} -p ${port} ${sqlFilePath}`;
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

async function main() {
  console.log("🌱 Starting database seed...");

  // eslint-disable-next-line unicorn/prefer-module
  const sqlFilePath = path.join(__dirname, "seed.sql");

  if (fs.existsSync(sqlFilePath)) {
    console.log("📁 Found seed.sql file - using pg_restore...");
    await runPgRestore(sqlFilePath);
    console.log("✅ Database seeded successfully from seed.sql!");
  } else {
    console.log(
      "📝 No seed.sql found - creating sample assignment data...",
    );
    await prisma.assignment.create({
      data: {
        name: "Cybersecurity Job Listing",
        type: "AI_GRADED",
        introduction:
          "In this project, you will explore a Cybersecurity job listing and relate it to the concepts learned in the course.",
        instructions: `Before submitting your responses, please ensure you have completed the following tasks:

  **Task 1: Identify Cybersecurity Role and Find Job Listing**
  [A] - Identify a Cybersecurity job role that interests you.
  [B] - Find a related job listing on a job board of your choice.

  **Task 2: Understand Job Details and Requirements**
  Research job details like responsibilities, location, salary, etc.

  **Task 3: Determine Job Attractiveness**
  Decide if the job fits your interests and career goals.

  **Task 4: Identify Gaps in your Portfolio**
  Compare your current qualifications with job requirements.

  **Task 5: Create a Plan**
  Develop a roadmap to become eligible for this job.
  `,
        gradingCriteriaOverview: `The assignment is worth 10 points and requires 60% to pass.

  [1] (1 point) Provide the URL for your selected job listing.
  [2] (2 points) Provide company name, job title, and job location.
  [3] (2 points) List at least 3 IT or cybersecurity skills required.
  [4] (2 points) Provide education, certifications, and experience details.
  [5] (3 points) Outline a plan to qualify for the job.

  Click "Begin Assignment" to submit your responses.`,
        graded: true,
        allotedTimeMinutes: 1,
        displayOrder: "RANDOM",
        showAssignmentScore: true,
        showQuestionScore: true,
        showSubmissionFeedback: true,
        numAttempts: undefined,
        timeEstimateMinutes: 1,
        published: true,
        questions: {
          createMany: {
            data: questions.map((q) => ({
              ...q,
              scoring: q.scoring as unknown as Prisma.InputJsonValue,
              choices: q.choices as unknown as Prisma.InputJsonValue,
            })),
          },
        },
        groups: {
          create: [
            {
              group: {
                connectOrCreate: {
                  where: {
                    id: "test-group-id",
                  },
                  create: {
                    id: "test-group-id",
                  },
                },
              },
            },
          ],
        },
      },
    });
    console.log("✅ Sample assignment created successfully!");
  }
}

main()
  .catch((error) => {
    console.error("❌ Error during seeding:");
    console.error(error);
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
