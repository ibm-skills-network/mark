import Button from "@learnerComponents/Button";
import Link from "next/link";
import React from "react";
import { twMerge } from "tailwind-merge";

interface Props extends React.ComponentPropsWithoutRef<"div"> {
  title?: string;
  attemptsAllowed?: number;
  timeLimit?: number;
  outOf?: number;
  onBegin?: () => void;
}

function IntroductionPage(props: Props & { params: { assignmentID: string } }) {
  const {
    title = "Introduction to Project Management",
    attemptsAllowed = 1,
    timeLimit = 50,
    outOf = 40,
    onBegin,
    className = "",
    params,
  } = props;

  return (
    <main className={twMerge("p-24 rounded-lg shadow-md h-full", className)}>
      <div className="border-2 p-4 flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
            {title}
          </h2>
          <div className="mt-1 flex flex-row space-x-2 text-sm text-gray-500">
            <div className="flex items-center">
              Attempts Allowed: {attemptsAllowed}
            </div>
            <div className="border-r border-gray-400 h-4 self-center"></div>
            <div className="flex items-center">
              Time Limit: {timeLimit} minutes
            </div>
            <div className="border-r border-gray-400 h-4 self-center"></div>
            <div className="flex items-center">Out Of: {outOf}</div>
          </div>
        </div>
        <Link href={`/learner/${params.assignmentID}/questions`}>
          <Button>Begin the Assignment {">"}</Button>
        </Link>
      </div>
      <div className="border-2 border-gray-400 bg-white p-4">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          About this Assignment
        </h3>
        <p className="text-gray-600 mb-4">
          Welcome to the &apos;Introduction to Project Management&apos; course!
          This comprehensive course is designed for individuals interested in
          starting a career in project management.
        </p>
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          Instructions
        </h3>
        <p className="text-gray-600 mb-4">
          The quiz consists of both multiple-choice questions and short answer
          paragraphs. You are required to select the most appropriate answer
          from the given options...
        </p>
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          Midterm Assignment Format:
        </h3>
        <p className="text-gray-600 mb-4">
          The Exam is open-book, open-notes. For your learning experience,
          it&apos;s best that you do not collaborate with anyone else on the
          assignment, in person or otherwise...
        </p>
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          Materials Covered:
        </h3>
        <p className="text-gray-600 mb-4">
          Midterm 1 will cover Weeks 2 - 7, or &apos;Nature of Science&apos;
          through &apos;History of Evolutionary Thought&apos;. Exams cover
          Lectures and Required materials. I will not directly test from the
          textbook or Supplemental materials.
        </p>
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          Value of Midterm Exams and Policies:
        </h3>
        <p className="text-gray-600 mb-4">
          There are 4 Midterm Exams in this course. We will take the top 3
          scores for a total of 40% of your final grade. That means each Midterm
          that is counted is worth ~13.3% of your final grade...
        </p>
      </div>
    </main>
  );
}

export default IntroductionPage;
