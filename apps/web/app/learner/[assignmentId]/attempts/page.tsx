"use client";
import React from "react";
import { IconExternalLink } from "@tabler/icons-react";
import { useLearnerOverviewStore } from "@/stores/learner";

// Define the structure of the `AttemptCard` props
type AttemptCardProps = {
  id: number;
  attemptNumber: number;
  score: string;
  time: string;
  isLatest?: boolean;
  assignmentId?: number;
  startedAt?: string;
  expiresAt?: string;
};

// Component for each attempt card
const AttemptCard: React.FC<AttemptCardProps> = ({
  id,
  attemptNumber,
  score,
  time,
  isLatest,
  assignmentId,
  startedAt,
  expiresAt,
}) => {
  return (
    <div className="border border-gray-200 bg-white rounded p-4 mt-4 relative shadow-sm">
      <h3 className="text-lg">
        Attempt {attemptNumber}{" "}
        {isLatest && (
          <span className="text-sm font-normal text-gray-500">
            (latest attempt)
          </span>
        )}
      </h3>
      <div className="flex gap-x-16 mt-2 text-sm">
        <p className="flex flex-col gap-y-2">
          <span className="text-gray-600">Score</span>
          <span>{score}</span>
        </p>
        <p className="flex flex-col gap-y-2">
          <span className="text-gray-600">Started At</span>
          <span>{startedAt}</span>
        </p>
        <p className="flex flex-col gap-y-2">
          <span className="text-gray-600">Expires At</span>
          <span>{expiresAt}</span>
        </p>
        <p className="flex flex-col gap-y-2">
          <span className="text-gray-600">Duration</span>
          <span>{time}</span>
        </p>
      </div>
      <a
        href={`/learner/${assignmentId}/successPage/${id}`}
        className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
        aria-label={`View details for Attempt ${attemptNumber}`}
      >
        <IconExternalLink size={20} />
      </a>
    </div>
  );
};

// Main component to display all attempts
const AssignmentAttempts: React.FC = () => {
  // Fetch listOfAttempts from the Zustand store
  const listOfAttempts = useLearnerOverviewStore(
    (state) => state.listOfAttempts,
  );
  const assignmentId = useLearnerOverviewStore((state) => state.assignmentId);

  // Sort attempts by `createdAt` in descending order before mapping
  const sortedAttempts = [...listOfAttempts].sort((a, b) =>
    a.createdAt && b.createdAt
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : 0,
  );

  // Format the sorted attempts data to pass into AttemptCard
  const attempts = sortedAttempts.map((attempt, index) => {
    const score =
      attempt.grade !== undefined
        ? `${Math.round(attempt.grade * 100)}%`
        : "N/A";
    const attemptStart = attempt.createdAt
      ? new Date(attempt.createdAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "numeric",
          hour12: true,
        })
      : "N/A";
    const attemptEnd = attempt.expiresAt
      ? new Date(attempt.expiresAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "numeric",
          hour12: true,
        })
      : "N/A";

    let time = "N/A";
    if (attempt.createdAt && attempt.expiresAt) {
      const createdAt = new Date(attempt.createdAt);
      const expiresAt = new Date(attempt.expiresAt);
      console.log(
        "expiresAt.getTime() - createdAt.getTime()",
        expiresAt.getTime() - createdAt.getTime(),
      );
      const timeTaken = (expiresAt.getTime() - createdAt.getTime()) / 1000;
      const hours = Math.floor(timeTaken / 3600);
      const minutes = Math.floor((timeTaken % 3600) / 60);
      const seconds = Math.floor(timeTaken % 60);
      time = `${hours}h ${minutes}m ${seconds}s`;
    }
    console.log(attempt);

    return {
      id: attempt.id,
      attemptNumber: sortedAttempts.length - index,
      score,
      attemptStart,
      attemptEnd,
      time,
      isLatest: index === 0,
      assignmentId: attempt.assignmentId,
    };
  });

  return (
    <div className="flex justify-center pt-10 bg-gray-50 flex-1">
      <div className="w-full max-w-4xl p-6">
        <h1 className="text-2xl font-bold mb-6">
          Assignment {assignmentId} Attempts
        </h1>
        {attempts.length > 0 ? (
          attempts.map((attempt) => (
            <AttemptCard
              key={attempt.id}
              {...attempt}
              startedAt={attempt.attemptStart}
              expiresAt={attempt.attemptEnd}
            />
          ))
        ) : (
          <div className="text-center text-gray-600">
            No attempts found for this assignment.
          </div>
        )}
      </div>
    </div>
  );
};

export default AssignmentAttempts;
