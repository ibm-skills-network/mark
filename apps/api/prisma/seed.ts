import { PrismaClient, Question } from "@prisma/client";
import {
  ScoringType,
  type CreateUpdateQuestionRequestDto,
} from "../src/api/assignment/question/dto/create.update.question.request.dto";

const prisma = new PrismaClient();

const questions: CreateUpdateQuestionRequestDto[] = [
  {
    question:
      "[1] Provide the URL for your selected job listing for a Cybersecurity role you can see yourself applying for in the future.",
    type: "TEXT",
    maxWords: 100,
    totalPoints: 2,
    scoring: {
      type: ScoringType.CRITERIA_BASED,
      criteria: [
        {
          description:
            "No, a valid URL for a job listing for a Cybersecurity role was not provided.",
          points: 0,
        },
        {
          description:
            "Yes, a valid URL for a job listing for a Cybersecurity role was provided.",
          points: 1,
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
      criteria: [
        {
          description:
            "No, the Company Name, Job Title, and Job Location were not provided.",
          points: 0,
        },
        {
          description:
            "Yes, the Company Name, Job Title, and Job Location were provided.",
          points: 1,
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
      criteria: [
        {
          description:
            "No, at least 3 IT or cybersecurity skills required for the selected Cybersecurity job listing were not provided.",
          points: 0,
        },
        {
          description:
            "Yes, at least 3 IT or cybersecurity skills required for the selected Cybersecurity job listing were provided.",
          points: 1,
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
      criteria: [
        {
          description:
            "No, the Education, Preferred Certifications, and Experience/background were not provided.",
          points: 0,
        },
        {
          description:
            "Yes, the Education, Preferred Certifications, and Experience/background were provided.",
          points: 1,
        },
      ],
    },
  },
];

async function main() {
  console.log("Start seeding...");

  const assignment = await prisma.assignment.create({
    data: {
      name: "Cybersecurity Job Listing",
      type: "AI_GRADED",
      introduction:
        "In this project, you will explore a Cybersecurity job listing and relate it to the concepts learned in the course.",
      instructions: `Before submitting your responses, please ensure you have completed the following tasks:

**Task 1: Identify Cybersecurity Role and Find Job Listing**
[A] - First, identify a Cybersecurity job role (for example, Cybersecurity Specialist / Cybersecurity Analyst / Cybersecurity Engineer / etc.) that you want to pursue as a career. It may be a role you want to start your Cybersecurity career with, or a role you aspire to pursue at some future point in your career journey. 

[B] - Next, search for job postings related to the identified Cybersecurity role that you find appealing by going to a job board of your choice (for example, LinkedIn, Indeed, Zip Recruiter, Glassdoor, Monster, Naukri, USAjobs.gov, jobbank.gc.ca, and so on.). You could filter or narrow down the job listings based on criteria like the location(s) you are interested in working, employment type (for example, full-time, part-time, freelance, consulting, and so on), industry (for example, Banking, Healthcare, IT, retail, and so on) or other factors. Identify one job listing that interests you, and you can see yourself applying when you have the right skills and qualifications.

**Task 2: Understand Job Details and Requirements**
Understand the job details (title, company, location, responsibilities, employment type, salary range, benefits, and so on) and requirements (skills, educational qualifications, experience, certifications, and so on).

**Task 3: Determine Job Attractiveness**
Identify aspects of the job that you find suitable and unsuitable. Are you still interested in applying for a job like this in the future? If not, repeat 1-3 above until you find a Cybersecurity job that you would like to take up in the future.

**Task 4: Identify Gaps in your Portfolio**
Perform a self-assessment and create an inventory of your current portfolio (skills, education, experience, certifications, and so on). Compare the portfolio with the job requirements and identify the gaps that you need to bridge to be eligible for the selected Cybersecurity job. For example, what skills and experience do you need to develop, and what educational qualifications and industry certifications do you need to achieve to become job-ready?

**Task 5: Create a Plan**
Based on the gaps in your portfolio versus the requirements listed in the job, create a roadmap of actions you need to take to become eligible for the chosen Cybersecurity job.  For example, how will you develop the required skills and prepare for any required certifications?  
`,
      gradingCriteriaOverview: `The assignment is worth 10 points and requires 60% to pass.

[1] (1 point) Provide the URL for your selected Job listing for a Cybersecurity role that you can see yourself applying for in the future.

[2] (2 points) Provide the following details from the selected Cybersecurity job posting: Company Name, Job Title, Job Location.

[3] (2 points) Provide at least 3 IT or cybersecurity skills required for the selected Cybersecurity job listing.

[4] (2 points) Provide the following details from the selected Cybersecurity job listing: Education, Preferred Certifications, Experience/background.

[5] (3 points) Based on your current education, experience, skills, and certifications, provide a list of steps you will need to take to be eligible to apply for the chosen Cybersecurity job listing. List the steps required using the following categories: Education/Experience, Skills, and Certifications.

Click on "Begin Assignment" (top right) to provide your responses to the above questions.`,
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
        // @ts-expect-error - The types ain't typing
        createMany: { data: questions },
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
  console.log("Created assignment with ID:", assignment.id);
}

main()
  .catch((error) => {
    console.error(error);
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
