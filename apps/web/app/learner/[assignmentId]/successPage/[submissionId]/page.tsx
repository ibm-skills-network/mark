"use client";

import animationData from "@/animations/LoadSN.json";
import Loading from "@/components/Loading";
import {
  AssignmentAttemptWithQuestions,
  AssignmentDetails,
  AssignmentFeedback,
  QuestionStore,
  RegradingRequest,
} from "@/config/types";
import {
  getAttempt,
  getCompletedAttempt,
  getFeedback,
  getUser,
  submitFeedback,
  submitRegradingRequest,
} from "@/lib/talkToBackend";
import Crown from "@/public/Crown.svg";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { Rating, RoundedStar } from "@smastrom/react-rating";
import { IconRefresh } from "@tabler/icons-react";
import Particles from "@tsparticles/react";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import Image, { StaticImageData } from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  buildStyles,
  CircularProgressbarWithChildren,
} from "react-circular-progressbar";
import Question from "../Question";
import "@smastrom/react-rating/style.css"; // Import rating component styles

import Button from "@/components/Button";
import ReportModal from "@/components/ReportModal";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";

const DynamicConfetti = dynamic(() => import("react-confetti"), {
  ssr: false,
});

function SuccessPage() {
  const pathname: string = usePathname();
  const attemptId = parseInt(pathname.split("/")?.[4], 10);
  const assignmentId = parseInt(pathname.split("/")?.[2], 10);
  // if the camera is on, we need to stop it

  // Local state variables
  const [questions, setQuestions] = useState([]);
  const [grade, setGrade] = useState(0);
  const [totalPointsEarned, setTotalPointsEarned] = useState(0);
  const [totalPoints, setTotalPoints] = useState(0);
  const [assignmentDetails, setAssignmentDetails] =
    useState<AssignmentDetails>();

  // Zustand state variables
  const [zustandQuestions, zustandTotalPointsEarned, zustandTotalPoints] =
    useLearnerStore((state) => [
      state.questions,
      state.totalPointsEarned,
      state.totalPointsPossible,
    ]);
  const setShowSubmissionFeedback = useLearnerStore(
    (state) => state.setShowSubmissionFeedback,
  );
  const [zustandAssignmentDetails, zustandGrade] = useAssignmentDetails(
    (state) => [state.assignmentDetails, state.grade],
  );

  const [pageHeight, setPageHeight] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"learner" | "author" | "undefined">(
    "undefined",
  );
  const [init, setInit] = useState(false);
  const [playAnimations, setPlayAnimations] = useState(true);

  // New state variables for feedback modal
  const [comments, setComments] = useState("");
  const [aiGradingRating, setAiGradingRating] = useState(0);
  const [assignmentRating, setAssignmentRating] = useState(0);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [isFeedbackModalOpen]);
  // State variables for regrading request modal
  const [regradingRequest, setRegradingRequest] = useState(false);
  const [regradingReason, setRegradingReason] = useState("");
  const [isRegradingModalOpen, setIsRegradingModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [BackendComments, setBackendComments] = useState("");
  const [regradingStatus, setRegradingStatus] = useState<
    "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED"
  >("PENDING");
  const [userId, setUserId] = useState<string>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [userPreferredLanguage, setUserPreferredLanguage] = useState("en");
  useEffect(() => {
    const fetchData = async () => {
      const user = await getUser();
      setRole(user.role);
      setUserId(user.userId);
      if (user.role === "learner") {
        // Fetch data from backend for learners
        try {
          const submissionDetails: AssignmentAttemptWithQuestions =
            await getCompletedAttempt(assignmentId, attemptId);
          setQuestions(submissionDetails.questions);
          setBackendComments(submissionDetails.comments || "");
          setShowSubmissionFeedback(
            submissionDetails.showSubmissionFeedback || false,
          );
          setUserPreferredLanguage(submissionDetails.preferredLanguage);
          setGrade(submissionDetails.grade * 100);
          if (submissionDetails.totalPointsEarned) {
            setTotalPoints(submissionDetails.totalPointsEarned);
          } else {
            const totalPoints = submissionDetails.questions.reduce(
              (acc, question) => acc + question.totalPoints,
              0,
            );
            const totalPointsEarned = totalPoints * submissionDetails.grade;
            setTotalPoints(
              totalPoints || submissionDetails.totalPossiblePoints,
            );
            setTotalPointsEarned(totalPointsEarned);
          }
          setAssignmentDetails({
            passingGrade: submissionDetails.passingGrade,
            id: submissionDetails.id,
            name: submissionDetails.name,
          });
          const response = await getFeedback(assignmentId, attemptId);
          if (response) {
            setComments(response.comments || "");
            setAiGradingRating(response.aiGradingRating || 0);
            setAssignmentRating(response.assignmentRating || 0);
          }
          setInit(true);
        } finally {
          setLoading(false);
        }
      } else if (user.role === "author") {
        // Use Zustand state for authors
        setQuestions(zustandQuestions);
        setGrade(zustandGrade);
        setTotalPointsEarned(zustandTotalPointsEarned);
        setTotalPoints(zustandTotalPoints);
        setAssignmentDetails(zustandAssignmentDetails);
        setLoading(false);
      } else {
        // Handle other roles or errors
        setLoading(false);
        // Optionally, show an error message or redirect
      }
    };
    void fetchData();
  }, [
    assignmentId,
    attemptId,
    zustandQuestions,
    zustandGrade,
    zustandTotalPointsEarned,
    zustandTotalPoints,
    zustandAssignmentDetails,
  ]);

  // Use Effect to Play Animations Once
  useEffect(() => {
    setPlayAnimations(true); // Trigger animations only once
    const timeout = setTimeout(() => setPlayAnimations(false), 5000); // Stop animations after 5 seconds
    return () => clearTimeout(timeout); // Cleanup timeout on unmount
  }, [grade]); // Trigger only when `grade` changes

  // Animation for the crown falling effect
  const crownAnimation = {
    initial: { y: -250, x: 0, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    transition: { type: "spring", stiffness: 50, damping: 10, duration: 1 },
  };

  // Custom animations based on grade
  const fireworksOptions = {
    fullScreen: {
      zIndex: 1,
    },
    particles: {
      number: {
        value: 50, // Initial fireworks burst
      },
      color: {
        value: ["#ff0000", "#ffcc00", "#00ff00", "#00aaff"],
      },
      shape: {
        type: ["circle"],
      },
      opacity: {
        value: 1, // Full opacity for fireworks
      },
      size: {
        value: { min: 3, max: 7 }, // Small particles for fireworks
      },
      emitters: {
        direction: "bottom", // Emit particles from the top
        position: {
          x: 50,
          y: 0,
        },
        rate: {
          quantity: 0,
          delay: 0,
        },
      },
      move: {
        enable: true,
        speed: 60, // Fast speed for fireworks
        direction: "none" as const, // Spread in all directions
        random: true,
        straight: false,
        outModes: {
          default: "destroy" as const, // Disappear after leaving the screen
        },
      },
      life: {
        duration: {
          sync: true,
          value: 2, // Short lifespan
        },
      },
      explode: {
        enable: true, // Fireworks explode effect
      },
      gravity: {
        enable: false, // No gravity for fireworks
      },
    },
  };
  const toggleFeedbackBar = () => {
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    const updatePageHeight = () => {
      setPageHeight(window.innerHeight);
    };

    // Set initial height
    updatePageHeight();

    // Update height on resize
    window.addEventListener("resize", updatePageHeight);
    return () => {
      window.removeEventListener("resize", updatePageHeight);
    };
  }, []);

  const sparkleOptions = {
    fullScreen: {
      zIndex: 1,
    },
    frameRate: 30,
    particles: {
      number: {
        value: 20, // Initial set of sparkles
      },
      color: {
        value: ["#FFD700"], // only gold
      },
      shape: {
        type: ["star"], // Star-shaped sparkles
      },
      opacity: {
        value: 1, // Full opacity for bright sparkles
      },
      size: {
        value: { min: 3, max: 8 }, // Small sparkles
      },
      move: {
        enable: true,
        speed: { min: 20, max: 30 }, // Fast movement for sparkles
        direction: "none" as const, // Random movement
        random: true,
        straight: false,
        outModes: {
          default: "destroy" as const, // Disappear after leaving the screen
        },
      },
      life: {
        duration: {
          sync: true,
          value: 2, // Short lifespan
        },
      },
      rotate: {
        value: { min: 0, max: 360 },
        direction: "random",
        animation: {
          enable: true,
          speed: 20,
        },
      },
      gravity: {
        enable: false, // No gravity for sparkles
      },
    },
  };

  if (loading) {
    return <Loading animationData={animationData} />;
  }
  const { passingGrade } = assignmentDetails || {
    passingGrade: 50,
    id: null,
  };

  const getGradeMessage = (grade: number): string => {
    if (BackendComments !== "") {
      return "Your submission was late";
    }
    if (grade >= 80) return "Impressive Mastery! ";
    if (grade >= 70) return "Strong Progress! ";
    if (grade >= 60) return "Solid Effort! ";
    if (grade >= 50) return "Steady Improvement! ";
    return "Keep Pushing Forward!";
  };

  const handleSubmitFeedback = async () => {
    if (assignmentId === null || attemptId === null) {
      console.error("Missing assignmentId or attemptId");
      return;
    }
    if (comments === "") {
      toast.error("Please provide your feedback comments.");
      return;
    }
    if (aiGradingRating === 0 || assignmentRating === 0) {
      toast.error("Please rate the assignment and AI grading.");
      return;
    }
    // Construct feedback object
    const feedbackData: AssignmentFeedback = {
      assignmentId: assignmentDetails?.id || assignmentId,
      userId: userId,
      comments,
      aiGradingRating,
      assignmentRating,
    };

    try {
      // Submit feedback to backend
      const response = await submitFeedback(
        assignmentId,
        attemptId,
        feedbackData,
      );
      if (response === true) {
        toast.success("Feedback submitted successfully!");
        setIsFeedbackModalOpen(false);
      } else {
        toast.error("Failed to submit feedback. Please try again.");
      }
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast.error("Failed to submit feedback. Please try again.");
    }
  };
  const handleSubmitRegradingRequest = async () => {
    // Construct regrading request object
    const regradingData: RegradingRequest = {
      assignmentId: assignmentId,
      userId: userId,
      attemptId: attemptId,
      reason: regradingReason,
    };
    if (regradingReason === "") {
      toast.error("Please provide a reason for regrading.");
      return;
    }
    if (assignmentDetails?.id === null) {
      console.error("Missing assignmentId");
      return;
    }
    if (userId === null) {
      console.error("Missing userId");
      return;
    }
    if (attemptId === null) {
      console.error("Missing attemptId");
      return;
    }
    try {
      // Submit regrading request to backend
      const response = await submitRegradingRequest(regradingData);
      if (response === true) {
        toast.success("Regrading request submitted successfully!");
        setIsRegradingModalOpen(false);
      } else {
        toast.error("Failed to submit regrading request. Please try again.");
      }
    } catch (error) {
      console.error("Error submitting regrading request:", error);
      toast.error("Failed to submit regrading request. Please try again.");
    }
  };

  return (
    <div className="relative pt-12 md:pt-16 flex flex-col items-center justify-start w-full min-h-screen gap-y-6 bg-gradient-to-b overflow-y-auto">
      {/* Fireworks Animation for Perfect Score */}
      {init && grade >= 90 && playAnimations && (
        <Particles
          id="fireworks"
          options={fireworksOptions}
          className="absolute inset-0 z-0"
        />
      )}

      {/* Sparkles Animation for Medium Grade */}
      {init && grade >= 60 && grade < 90 && playAnimations && (
        <Particles
          id="sparkles"
          options={sparkleOptions}
          className="absolute inset-0 z-0"
        />
      )}
      {/* Confetti Animation */}
      {grade >= passingGrade && (
        <DynamicConfetti
          recycle={false}
          numberOfPieces={200}
          width={window.innerWidth}
          height={pageHeight}
        />
      )}
      <div className="w-full max-w-4xl z-10 px-4 sm:px-6 md:px-8">
        <div className="flex flex-col items-center text-center gap-y-6">
          {/* Achievement Badge */}

          {!Number.isNaN(grade) ? (
            <>
              <div className="w-full flex flex-col md:flex-row md:items-center justify-center gap-6 md:gap-16 bg-white p-6 rounded-lg shadow-md">
                <div className="flex flex-col items-start gap-4">
                  <motion.h1
                    className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold text-gray-800 text-center"
                    initial={{ opacity: 0, y: -30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {grade >= 90
                      ? "Legendary Performance! 🏆"
                      : getGradeMessage(grade)}
                  </motion.h1>

                  <motion.p
                    className="text-xl text-left text-gray-600"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {BackendComments === "" ? (
                      grade >= passingGrade ? (
                        <>
                          <strong className="text-green-600">
                            Congratulations on successfully completing this
                            assignment!
                          </strong>{" "}
                          Your grade has been recorded. Feel free to close this
                          tab and return to the main course page.
                        </>
                      ) : (
                        <>
                          <strong>
                            Keep going! Mistakes are opportunities to learn and
                            grow.
                          </strong>{" "}
                          Review your answers and{" "}
                          <strong
                            className="cursor-pointer underline"
                            onClick={() =>
                              (window.location.href = `/learner/${assignmentId}/`)
                            }
                          >
                            try again
                          </strong>{" "}
                          to achieve your best result.
                        </>
                      )
                    ) : (
                      <>
                        <p>{BackendComments}</p>
                      </>
                    )}
                  </motion.p>

                  {/* required passing grade  */}
                  <motion.p
                    className="text-xl text-black"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    Required passing grade: {passingGrade}%
                  </motion.p>
                  {/* status */}
                  <motion.p
                    className="text-xl "
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    Status:
                    <span
                      className={`ml-1 font-semibold
                        ${
                          grade >= passingGrade
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                    >
                      {grade >= passingGrade ? "Passed" : "Failed"}
                    </span>
                  </motion.p>
                  <motion.p
                    className="text-xl "
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    Final Score: {Math.round(totalPointsEarned)} /{" "}
                    {Math.round(totalPoints)} ({Math.round(grade)}%)
                  </motion.p>
                </div>
                <motion.div className="flex flex-col items-center h-full mb-10 ">
                  {Math.round(grade) === 100 && (
                    <motion.div
                      {...crownAnimation}
                      className="w-full h-full flex items-center justify-center mb-2"
                    >
                      <Image
                        src={Crown as StaticImageData}
                        alt="Crown"
                        width={96}
                        height={96}
                      />
                    </motion.div>
                  )}
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.5, type: "spring" }}
                    className="w-36 h-36 md:w-48 md:h-30 mx-auto"
                  >
                    <CircularProgressbarWithChildren
                      value={Math.round(grade)}
                      styles={buildStyles({
                        pathColor:
                          grade >= passingGrade ? "#10B981" : "#EF4444",
                        textColor: "#374151",
                        trailColor: "#D1D5DB",
                        backgroundColor: "#fff",
                      })}
                    >
                      <div className="text-[35px] font-bold text-gray-500">
                        {Math.round(grade)}%
                      </div>
                    </CircularProgressbarWithChildren>
                  </motion.div>
                </motion.div>
              </div>
            </>
          ) : (
            <motion.h1
              className="text-5xl font-extrabold text-gray-800"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Grades are currently unavailable as the author has disabled
              viewing them.
            </motion.h1>
          )}
        </div>

        {role === "learner" && (
          <div className="flex flex-col sm:flex-row items-center gap-y-4 sm:gap-y-0 gap-x-4 justify-center p-4">
            <button
              onClick={() => setIsFeedbackModalOpen(true)}
              className="px-6 py-3 bg-violet-100 hover:bg-violet-200 text-violet-800 rounded-md transition "
            >
              <div className="flex items-center gap-x-2">
                Provide Assignment Feedback
              </div>
            </button>
          </div>
        )}
        {/* Questions Summary */}
        <div className="mt-4">
          {questions.map((question: QuestionStore, index: number) => (
            <motion.div
              className="p-4 sm:p-6  bg-white rounded-lg shadow-lg w-full max-w-4xl mx-auto mb-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              key={question.id}
            >
              <Question
                number={index + 1}
                question={question}
                language={userPreferredLanguage}
              />
            </motion.div>
          ))}
        </div>
        {/* Action Buttons */}
        <div className="flex flex-wrap justify-between mb-10 px-5">
          {/* This should stay commented until the author new interface is ready */}
          {/* <button
            onClick={() => setIsRegradingModalOpen(true)}
            className="px-6 py-3 bg-violet-100 hover:bg-violet-200 text-violet-800 rounded-md transition "
          >
            <div className="flex items-center gap-x-2">Report a Mark Error</div>
          </button> */}
          {role === "learner" && (
            <div className="flex items-center gap-x-4 justify-center">
              <button
                onClick={() => setIsReportModalOpen(true)}
                className="px-6 py-3 bg-violet-100 hover:bg-violet-200 text-violet-800 rounded-md transition mb-2 sm:mb-0"
              >
                <div className="flex items-center gap-x-2">Report an issue</div>
              </button>
            </div>
          )}
          <Button
            onClick={() =>
              role?.toLowerCase() === "learner"
                ? (window.location.href = `/learner/${assignmentId}/`)
                : role?.toLowerCase() === "author"
                  ? (window.location.href = `/learner/${assignmentId}/?authorMode=true`)
                  : (window.location.href = "/")
            }
            className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-md transition flex items-center gap-2 shadow-lg mt-2"
          >
            {/* SVG Icon */}
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <IconRefresh className="w-6 h-6 text-white" />
            </svg>
            Retake Assignment
          </Button>
        </div>
      </div>
      {/* Feedback Modal */}
      <AnimatePresence>
        {isFeedbackModalOpen && (
          <Dialog
            as={motion.div}
            static
            className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50"
            open={isFeedbackModalOpen}
            onClose={() => setIsFeedbackModalOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="min-h-screen px-4 text-center">
              {/* Centering Modal Content */}
              <span
                className="inline-block h-screen align-middle"
                aria-hidden="true"
              >
                &#8203;
              </span>
              <motion.div
                className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg"
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
              >
                <DialogPanel>
                  <DialogTitle
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900 mb-4"
                  >
                    <div className="flex justify-between items-center">
                      We Value Your Feedback
                      <XMarkIcon
                        className="w-6 h-6 text-gray-500 hover:cursor-pointer"
                        onClick={() => setIsFeedbackModalOpen(false)}
                      />
                    </div>
                  </DialogTitle>

                  <div className="flex flex-col items-center gap-4 mb-4">
                    {/* Assignment Rating */}
                    <div className="text-center">
                      <label className="block text-gray-700 font-semibold mb-2">
                        Rate the Assignment
                      </label>
                      <Rating
                        key={`assignment-rating-${assignmentRating}-${String(
                          isFeedbackModalOpen,
                        )}`}
                        value={assignmentRating}
                        onChange={(value: number) => setAssignmentRating(value)}
                        style={{ maxWidth: 200 }}
                        itemStyles={{
                          itemShapes: RoundedStar,
                          activeFillColor: "#7C3AED",
                          inactiveFillColor: "#72777C",
                        }}
                      />
                    </div>
                    {/* AI Grading Rating */}
                    <div className="text-center">
                      <label className="block text-gray-700 font-semibold mb-2">
                        Rate the AI Grading
                      </label>
                      <Rating
                        key={`assignment-rating-${assignmentRating}-${String(
                          isFeedbackModalOpen,
                        )}`}
                        value={aiGradingRating}
                        onChange={(value: number) => setAiGradingRating(value)}
                        style={{ maxWidth: 200 }}
                        itemStyles={{
                          itemShapes: RoundedStar,
                          activeFillColor: "#7C3AED",
                          inactiveFillColor: "#72777C",
                        }}
                      />
                    </div>
                  </div>

                  {/* Comments */}
                  <div>
                    <label className="block text-gray-700 font-semibold mb-2">
                      Your Comments:
                    </label>
                    <textarea
                      className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={3}
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      placeholder="Share your thoughts or suggestions..."
                    ></textarea>
                  </div>
                  {/* Submit Button */}
                  <div className="text-center">
                    <button
                      onClick={handleSubmitFeedback}
                      className="px-6 py-2 mt-2 bg-violet-600 hover:bg-violet-500 text-white rounded-md transition shadow-lg"
                    >
                      Submit Feedback
                    </button>
                  </div>
                </DialogPanel>
              </motion.div>
            </div>
          </Dialog>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isReportModalOpen && (
          <ReportModal
            assignmentId={assignmentId}
            attemptId={attemptId}
            isReportModalOpen={isReportModalOpen}
            setIsReportModalOpen={setIsReportModalOpen}
            isAuthor={role === "author"}
          />
        )}
      </AnimatePresence>

      {/* Regrading Request Modal */}
      {/* This should stay commented until the author new interface is ready */}
      {/* <AnimatePresence>
        {isRegradingModalOpen && (
          <Dialog
            as={motion.div}
            static
            className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50"
            open={isRegradingModalOpen}
            onClose={() => setIsRegradingModalOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="min-h-screen px-4 text-center">
              <span
                className="inline-block h-screen align-middle"
                aria-hidden="true"
              >
                &#8203;
              </span>
              <motion.div
                className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg"
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
              >
                <DialogPanel>
                  <DialogTitle
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900 mb-4"
                  >
                    <div className="flex justify-between items-center">
                      Regrading Form Request
                      <XMarkIcon
                        className="w-6 h-6 text-gray-500 hover:cursor-pointer"
                        onClick={() => setIsRegradingModalOpen(false)}
                      />
                    </div>
                  </DialogTitle>
                  <div className="space-y-4">
                    <div className="text-gray-600">
                      Regraded will be sent to and completed an instructor.
                    </div>
                    <div>
                      <label className="block text-gray-700 font-semibold mb-2">
                        Reason for Regrading:
                      </label>
                      <textarea
                        className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={5}
                        value={regradingReason}
                        onChange={(e) => setRegradingReason(e.target.value)}
                        placeholder="Provide details for your regrading request..."
                      ></textarea>
                    </div>
                    <div className="text-center">
                      <button
                        onClick={handleSubmitRegradingRequest}
                        className="px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-md transition shadow-lg"
                      >
                        Submit Regrading Request
                      </button>
                    </div>
                  </div>
                </DialogPanel>
              </motion.div>
            </div>
          </Dialog>
        )}
      </AnimatePresence> */}
    </div>
  );
}

export default SuccessPage;
