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
      description="Your session may have expired or you may not be logged in to Author Workbench. Try logging into AWB again, then relaunch the assignment from your course."
      footnote="Still stuck? Make sure you’re signed in to the right account and that you have a valid enrollment or instructor access."
    />
  );
}
