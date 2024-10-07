"use client";
import React from "react";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { useAssignmentConfig } from "../../../../stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "../../../../stores/assignmentFeedbackConfig";
import { useAuthorStore } from "../../../../stores/author";
import Question from "../../(components)/AuthorQuestionsPage/Question";
import { usePathname, useRouter } from "next/navigation"; // Importing useRouter for navigation
import { extractAssignmentId } from "@/lib/strings";

// Reusable Component for sections with similar structure (title, content, edit button, and optional navigation link)
const Section = ({
  title,
  content,
  link,
}: {
  title: string;
  content: string;
  link?: string; // Optional link to navigate when clicking the pencil icon
}) => {
  const router = useRouter(); // Hook for navigation

  return (
    <div className="flex flex-col gap-y-4 px-8 py-6 bg-white rounded border border-gray-200 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-center justify-between w-full">
        <h4 className="text-grey-900 text-xl">{title}</h4>
        {link && (
          <button onClick={() => router.push(link)}>
            <PencilSquareIcon className="h-6 w-6 text-gray-500" />
          </button>
        )}
      </div>
      <p className="text-gray-900 text-sm font-medium">
        {content || "Nothing has been added yet"}
      </p>
    </div>
  );
};

function Component() {
  const [
    graded,
    allotedTimeMinutes,
    timeEstimateMinutes,
    numAttempts,
    passingGrade,
    displayOrder,
    questionDisplay,
  ] = useAssignmentConfig((state) => [
    state.graded,
    state.allotedTimeMinutes,
    state.timeEstimateMinutes,
    state.numAttempts,
    state.passingGrade,
    state.displayOrder,
    state.questionDisplay,
  ]);

  const [introduction, instructions, gradingCriteriaOverview, questions] =
    useAuthorStore((state) => [
      state.introduction,
      state.instructions,
      state.gradingCriteriaOverview,
      state.questions,
    ]);

  const verbosityLevel = useAssignmentFeedbackConfig(
    (state) => state.verbosityLevel,
  );

  // Function to render assignment configurations
  const renderConfigItem = (label: string, value: string | number | null) => (
    <div className="flex flex-col">
      <h6 className="text-gray-600 text-sm font-medium">{label}</h6>
      <p className="text-gray-900 text-sm font-medium">{value ?? "Not set"}</p>
    </div>
  );
  const router = useRouter(); // Hook for navigation
  const pathname = usePathname(); // Hook for getting the current pathname
  const activeAssignmentId = extractAssignmentId(pathname); // Extracting assignment ID from the pathname

  return (
    <main className="main-author-container">
      <h1 className="text-grey-900 text-4xl">Review</h1>

      {/* Sections with links passed for navigation */}
      <Section
        title="About this Assignment"
        content={introduction?.replace(/<[^>]*>?/gm, "")}
        link={`/author/${activeAssignmentId}`}
      />
      <Section
        title="Learner Instructions"
        content={instructions?.replace(/<[^>]*>?/gm, "")}
        link={`/author/${activeAssignmentId}`}
      />
      <Section
        title="Grading Criteria"
        content={gradingCriteriaOverview?.replace(/<[^>]*>?/gm, "")}
        link={`/author/${activeAssignmentId}`}
      />

      <div className="flex flex-col gap-y-4 px-8 py-6 bg-white rounded border border-gray-200 shadow-sm hover:shadow-md transition-all">
        <div className="flex items-center justify-between w-full">
          <h4 className="text-grey-900 text-xl">Assignment Configuration</h4>
          <button
            onClick={() => router.push(`/author/${activeAssignmentId}/config`)}
          >
            <PencilSquareIcon className="h-6 w-6 text-gray-500" />
          </button>
        </div>

        {renderConfigItem("Assignment type", graded ? "Graded" : "Practice")}
        {renderConfigItem(
          "Assignment time",
          allotedTimeMinutes !== 0
            ? `${allotedTimeMinutes} minutes`
            : "No time limit set",
        )}
        {renderConfigItem(
          "Estimated time to complete assignment",
          timeEstimateMinutes !== 0
            ? `${timeEstimateMinutes} minutes`
            : "No estimated time set",
        )}
        {renderConfigItem(
          "Assignment attempts",
          numAttempts !== null
            ? `${numAttempts === -1 ? "Unlimited" : numAttempts}`
            : "No attempts limit set",
        )}
        {renderConfigItem(
          "Passing threshold",
          passingGrade !== null ? `${passingGrade}` : "No passing threshold",
        )}
        {renderConfigItem(
          "Feedback verbosity (not shown to learners)",
          verbosityLevel.toString(),
        )}
        {renderConfigItem(
          "Question order",
          displayOrder?.charAt(0).toUpperCase() +
            displayOrder?.slice(1).toLowerCase(),
        )}
        {renderConfigItem(
          "Question display",
          questionDisplay?.charAt(0).toUpperCase() +
            questionDisplay?.slice(1).toLowerCase().replace(/_/g, " "),
        )}
      </div>

      {/* Questions Section */}
      <h1 className="text-violet-800 text-2xl font-bold">Questions</h1>
      {questions.map((question, index) => (
        <div
          key={index}
          className="flex flex-col gap-y-4 px-8 py-6 bg-white rounded border border-gray-200 shadow-sm hover:shadow-md transition-all"
        >
          <Question
            question={question}
            questionId={question.id}
            questionIndex={index + 1}
            preview={true}
          />
        </div>
      ))}
    </main>
  );
}

export default Component;
