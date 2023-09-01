"use client";

import { Question, QuestionStatus } from "@/config/types";
import { questionsData } from "@config/constants";
import Button from "@learnerComponents/Button";
import Overview from "@learnerComponents/Overview";
import QuestionContainer from "@learnerComponents/QuestionContainer";
import { useState } from "react";

function LearnerLayout() {
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [questionStatuses, setQuestionStatuses] = useState<QuestionStatus[]>(
    questionsData.map(() => "unanswered")
  );

  const [submitting, setSubmitting] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [submittedSuccessfully, setSubmittedSuccessfully] = useState(false);

  const isLastQuestion = currentIndex === questionsData.length - 1;

  const updateStatus = (status: QuestionStatus) => {
    setQuestionStatuses((prevStatuses) => {
      const updatedStatuses = [...prevStatuses];
      updatedStatuses[currentIndex] = status;
      return updatedStatuses;
    });
  };

  const handleSubmission = () => {
    setShowWarning(false);

    setSubmitting(true);

    setTimeout(() => {
      setSubmitting(false);
      setSubmittedSuccessfully(true);
    }, 2000);
  };

  return (
    <main className="p-24 grid grid-cols-4 gap-x-5">
      {submittedSuccessfully ? (
        <div className="col-span-4 flex items-center justify-center h-full">
          <h1>Thank you for your submission!</h1>
        </div>
      ) : (
        <>
          <div className="col-span-3 -mt-6">
            {questionsData.map((question, index) => (
              <QuestionContainer
                key={index}
                questionNumber={index + 1}
                className={`${index === currentIndex ? "" : "hidden"} `}
                question={question}
                updateStatus={updateStatus}
              />
            ))}

            <div className="flex justify-between mt-4">
              <Button
                onClick={() => setCurrentIndex(currentIndex - 1)}
                style={{
                  opacity: currentIndex === 0 ? 0 : 1,
                  cursor: currentIndex === 0 ? "default" : "pointer",
                }}
                disabled={currentIndex === 0}
              >
                Previous
              </Button>

              {isLastQuestion ? (
                <Button
                  onClick={() => setShowWarning(true)}
                  disabled={submitting}
                >
                  {submitting ? "Submitting..." : "Submit Assignment"}
                </Button>
              ) : (
                <Button
                  onClick={() => setCurrentIndex(currentIndex + 1)}
                  disabled={currentIndex === questionsData.length - 1}
                >
                  Next
                </Button>
              )}
            </div>
          </div>
          <div className="col-span-1">
            <Overview
              questionstatus={questionStatuses}
              timeLimit={3600}
              setCurrentIndex={setCurrentIndex}
            />
          </div>

          {/* Submission Warning Modal */}
          {showWarning && (
            <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center bg-opacity-50 bg-black">
              <div className="bg-white p-8 rounded shadow-lg">
                <p>
                  Once submitted, no more changes can be made. Are you sure you
                  want to submit?
                </p>
                <div className="flex justify-end mt-4">
                  <Button onClick={() => setShowWarning(false)}>Cancel</Button>
                  <Button className="ml-2" onClick={handleSubmission}>
                    Yes, Submit
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default LearnerLayout;
