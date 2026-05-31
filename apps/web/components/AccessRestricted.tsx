import LearnerNotice from "./LearnerNotice";

/**
 * Shown when a learner is authenticated but not allowed to view an assignment
 * (403). Unlike a session expiry, reloading won't help, so there's no reload
 * action — just clear guidance on how to regain access.
 */
export default function AccessRestricted() {
  return (
    <LearnerNotice
      title="You don’t have access to this assignment"
      description="Make sure you’re signed in to the right account and opening it from your course. You may need a valid enrollment or instructor access."
      footnote={
        <>
          Still stuck? Relaunch the assignment from{" "}
          <span className="text-gray-500">Coursera</span>,{" "}
          <span className="text-gray-500">edX</span>,{" "}
          <span className="text-gray-500">Author Workbench</span>, or{" "}
          <span className="text-gray-500">yourLearning</span> — or contact your
          instructor.
        </>
      }
    />
  );
}
