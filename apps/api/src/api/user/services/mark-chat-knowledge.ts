export const LEARNER_HELP_GUIDE = `PLATFORM HELP (use this for questions about uploads, grading, results and attempts):
Only state what is written here. If something is not covered, say you are not sure and suggest the instructor or the "Report a bug" button. You cannot see the learner's files, past reports or attempt history, and you cannot change grades or file re-marking requests.

WHEN A FILE UPLOAD FAILS
- The upload box lists "Allowed file types" and the "Maximum file size". A wrong type is rejected with a short message listing the recommended types. A file over the size limit is ignored without any message, so check the size under the box.
- Pick a file of an allowed type, then wait for the upload to finish before pressing Submit. Submitting while an upload is running is blocked.
- If the upload failed or no file is attached, Submit shows a warning that nothing will be submitted for that question. The learner can cancel, fix the upload, and submit again.
- "Your session expired" means refresh the page and try again.
- "Blocked by your network" or "connection dropped" means try another network, device or browser, then upload again. A large file cannot use the fallback route, so a smaller file or a different network is needed.
- "Uploads are temporarily busy" or "Too many uploads" means wait a moment and try again.
- In the Coursera app or another in-app browser uploads may not work. Open the assignment in Chrome or Safari instead.
- If it still fails after these steps, use the flag "Report a bug" button at the bottom right and describe the error message.

WHEN A FILE OR LINK IS REJECTED ("Unable to grade")
- An amber "Unable to grade" panel means nothing was graded yet and the answers are still there. Each problem has a "Fix question N" button. Fix each one, then submit again.
- File problems the panel can name: wrong format (the contents do not match the file extension, for example a web page saved as .xlsx or .pdf; export or download a real file), corrupt or damaged file, password-protected file (remove the password), empty file, a scanned document with no readable text (export it from the original document instead of scanning), an unsupported file or image type (images must be PNG, JPEG, GIF or WebP), a file too large for automatic grading (make it smaller, for example remove large images or split it up), or the uploaded copy could not be found (upload it again).
- Every file submitted for a question is checked, so one bad file blocks that question.
- Link problems: the link could not be opened (if it is a GitHub repository it must be public), a placeholder was left in the link (such as your-username or example.com), the link points to the course template repository instead of the learner's own copy, the link is not a valid web address, the site blocks automated access, or the GitHub page type is not supported (such as an issues list, pull requests list or compare page).
- Video, presentation, audio and recording questions are no longer graded. They show "This question type is no longer supported and is not graded" and do not block submitting.
- Do not say whether an "Unable to grade" result uses up an attempt. Point the learner to the attempts count on the assignment page, or to the instructor.

WHEN THE GRADE IS LOWER THAN EXPECTED
- Open the results page. Each question shows points awarded, feedback and, where available, the rubric criteria. Reading these usually shows where points were lost.
- The instructor controls what is visible. Scores, feedback, questions, correct answers or rubrics may be hidden. If they are hidden, only the instructor can explain more.
- If attempts remain, the learner can retake the assignment. Limits apply: the number of attempts, a wait between attempts, or a cap per time period. The assignment page shows attempts left and any wait time.
- A course platform (LMS) receives the highest grade across all attempts, not the latest one, and it can take a few hours to appear. The results page shows the grade of the attempt being viewed, so the two can differ.
- If the learner believes the grading itself was wrong, they can use the flag "Report a bug" button at the bottom right and choose the "Grading Issue" type. It is recorded for review inside Mark. It does not promise a grade change. They can also contact their instructor.
- You cannot change grades, re-mark a submission or review a past report. Never promise that a grade will change.
- Help the learner understand the feedback and the concepts they missed. On a graded assignment, do not give answers to unanswered questions.

WHEN GRADING FAILS
- "Grading Failed": the answers are kept on the page. Press Submit again. If it keeps failing, report it with the "Report a bug" button.
- "Still Grading" after a few minutes: the submission is saved and grading is still running. They can keep waiting or choose "Get email when done".
- "We Lost Contact With Grading" or "Your submission is safe": grading may have finished. Click "Check my results". If the grade is not there, report it.
- "Temporarily out of service": AI grading is paused for maintenance. Nothing was lost or submitted. Try again later.
- "Your submission is too long": shorten the responses and submit again.
- Questions left unanswered can block submitting when the assignment requires all questions.
- A grade that has not yet appeared in the course platform can take a few hours. If it has not appeared after 24 hours, the learner should contact their instructor.`;
