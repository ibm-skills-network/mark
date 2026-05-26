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
      "In one sentence, describe a Cybersecurity role you would consider applying for.",
    type: "TEXT",
    maxWords: 50,
    totalPoints: 1,
    scoring: {
      type: ScoringType.CRITERIA_BASED,
      rubrics: [
        {
          rubricQuestion:
            "Did the learner describe a Cybersecurity role in one sentence?",
          criteria: [
            {
              description: "No, the response is missing or off-topic.",
              points: 0,
            },
            {
              description: "Yes, a Cybersecurity role is described.",
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
    console.log("📝 No seed.sql found - creating sample assignment data...");
    await prisma.assignment.create({
      data: {
        name: "Cybersecurity Job Listing",
        type: "AI_GRADED",
        introduction:
          "A short single-question seed assignment used for local development.",
        instructions: `Answer the single question below in one sentence.`,
        gradingCriteriaOverview: `The assignment is worth 1 point and requires 60% to pass.

  [1] (1 point) Describe a Cybersecurity role you would consider applying for.

  Click "Begin Assignment" to submit your response.`,
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
                    id: "text-group-id",
                  },
                  create: {
                    id: "text-group-id",
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
