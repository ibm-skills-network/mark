"use client";

import ErrorPage from "@/components/ErrorPage";
import MarkdownViewer from "@/components/MarkdownViewer";
import {
  Assignment,
  AssignmentAttempt,
  LearnerAssignmentState,
} from "@/config/types";
import { useLearnerOverviewStore } from "@/stores/learner";
import Link from "next/link";
import React, { FC, use, useEffect } from "react";
import BeginTheAssignmentButton from "./BeginTheAssignmentButton";

// Reusable section component for instructions and criteria
interface AssignmentSectionProps {
  title: string;
  content: string;
}

const AssignmentSection: FC<AssignmentSectionProps> = ({ title, content }) => (
  <div className="bg-white shadow p-6 rounded-lg">
    <h2 className="text-xl font-semibold text-gray-800 mb-4">{title}</h2>
    <MarkdownViewer className="text-gray-600">
      {content || `No ${title.toLowerCase()} provided.`}
    </MarkdownViewer>
  </div>
);

interface AboutTheAssignmentProps {
  assignment: Assignment;
  attempts: AssignmentAttempt[];
  role: "learner" | "author";
  assignmentId: number;
}

// Utility function to determine assignment state
const getAssignmentState = (
  attempts: AssignmentAttempt[],
  numAttempts: number
): LearnerAssignmentState => {
  if (numAttempts !== -1 && attempts.length >= numAttempts) return "completed";

  const inProgress = attempts.find(
    (attempt) =>
      !attempt.submitted &&
      (!attempt.expiresAt || Date.now() < new Date(attempt.expiresAt).getTime())
  );

  return inProgress ? "in-progress" : "not-started";
};

const AboutTheAssignment: FC<AboutTheAssignmentProps> = ({
  assignment,
  attempts,
  role,
  assignmentId,
}) => {
  // Destructure assignment properties with default values
  const {
    introduction = "No introduction provided.",
    instructions = "",
    gradingCriteriaOverview = "",
    allotedTimeMinutes,
    timeEstimateMinutes,
    numAttempts = -1,
    passingGrade,
    name = "Untitled",
    id,
    graded,
    published = false,
  } = assignment;
  const assignmentState =
    !published && role === "learner"
      ? "not-published"
      : getAssignmentState(attempts, numAttempts);

  const attemptsLeft =
    (numAttempts ?? -1) === -1
      ? Infinity
      : Math.max(0, numAttempts - attempts.length);

  // find the latest attempt date
  const latestAttempt = attempts.reduce((latest, attempt) => {
    if (!latest) return attempt;
    if (
      new Date(attempt.createdAt).getTime() >
      new Date(latest.createdAt).getTime()
    ) {
      return attempt;
    }
    return latest;
  }, null);
  const latestAttemptDate = latestAttempt
    ? new Date(latestAttempt.createdAt).toLocaleString()
    : "No attempts yet";
  return (
    <main className="grid grid-cols-1 md:grid-cols-[1fr_8fr_1fr] gap-4 px-4 md:px-0 flex-1 py-12 bg-gray-50">
      <div className="hidden md:block"> </div>
      <div className="max-w-screen-lg w-full mx-auto p-4 rounded-lg space-y-6">
        <div className="flex flex-col lg:flex-row gap-y-4 lg:gap-x-4 items-start lg:items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900">
              {name}
            </h1>
            <div className="flex flex-wrap gap-x-4 gap-y-2 items-center text-gray-600 pt-2">
              <span className="font-semibold text-sm sm:text-base">
                Latest attempt: {latestAttemptDate}
              </span>
              {role === "learner" && (
                <Link
                  href={`/learner/${id}/attempts`}
                  className="text-violet-600 text-sm sm:text-base"
                >
                  See all attempts
                </Link>
              )}
            </div>
          </div>
          <BeginTheAssignmentButton
            className="w-full lg:w-auto"
            assignmentState={assignmentState}
            assignmentId={id}
            role={role}
            attemptsLeft={attemptsLeft}
          />
        </div>

        <div className="bg-white shadow pt-4 rounded-lg">
          <h2 className="text-xl font-semibold text-gray-800 px-6 py-2">
            About this assignment
          </h2>
          <div className="flex flex-wrap justify-between px-6 py-4">
            <div className="flex flex-col gap-y-2 text-gray-600">
              <span className="font-semibold">Assignment type</span>
              <span>{graded ? "Graded" : "Practice"}</span>
            </div>
            <div className="flex flex-col gap-y-2 text-gray-600">
              <span className="font-semibold">Time Limit</span>
              <span>
                {allotedTimeMinutes
                  ? `${allotedTimeMinutes} minutes`
                  : "Unlimited"}
              </span>
            </div>
            <div className="flex flex-col gap-y-2 text-gray-600">
              <span className="font-semibold">Estimated Time</span>
              <span>
                {timeEstimateMinutes
                  ? `${timeEstimateMinutes} minutes`
                  : "Not provided"}
              </span>
            </div>
            <div className="flex flex-col gap-y-2 text-gray-600">
              <span className="font-semibold">Assignment attempts</span>
              <span>
                {
                  // if attempts are -1 or null then it's unlimited else
                  // show the number of attempts left
                  numAttempts === -1
                    ? "Unlimited"
                    : `${attemptsLeft} attempt${
                        attemptsLeft > 1 ? "s" : ""
                      } left`
                }
              </span>
            </div>
            <div className="flex flex-col gap-y-2 text-gray-600">
              <span className="font-semibold">Passing threshold</span>
              <span>{passingGrade}%</span>
            </div>
          </div>
          <div className="border-t border-gray-200 px-6 py-4">
            <MarkdownViewer className="text-gray-600">
              {introduction}
            </MarkdownViewer>
          </div>
        </div>

        <AssignmentSection title="Instructions" content={instructions} />
        <AssignmentSection
          title="Grading Criteria"
          content={gradingCriteriaOverview}
        />

        <div className="flex justify-center mt-6">
          <BeginTheAssignmentButton
            assignmentState={assignmentState}
            assignmentId={id}
            role={role}
            attemptsLeft={attemptsLeft}
          />
        </div>
      </div>
      <div className="hidden md:block"> </div>
    </main>
  );
};

export default AboutTheAssignment;
