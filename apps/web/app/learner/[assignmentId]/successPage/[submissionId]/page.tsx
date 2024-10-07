"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import {
  CircularProgressbarWithChildren,
  buildStyles,
} from "react-circular-progressbar";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import Question from "../Question";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadFull } from "tsparticles";
import Crown from "@/public/Crown.svg";
import Image, { StaticImageData } from "next/image";
import ExitIcon from "@/components/svgs/ExitIcon";
import { IconRefresh } from "@tabler/icons-react";
import { getAttempt, getUser } from "@/lib/talkToBackend";
import {
  AssignmentAttemptWithQuestions,
  AssignmentDetails,
  QuestionStore,
} from "@/config/types";
import Loading from "@/components/Loading";
import ErrorPage from "@/components/ErrorPage";
const DynamicConfetti = dynamic(() => import("react-confetti"), {
  ssr: false,
});

function SuccessPage() {
  const pathname: string = usePathname();
  const router = useRouter();
  const id = parseInt(pathname.split("/")?.[4], 10);
  const assignmentId = parseInt(pathname.split("/")?.[2], 10);

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
  const [zustandAssignmentDetails, zustandGrade] = useAssignmentDetails(
    (state) => [state.assignmentDetails, state.grade],
  );

  const [pageHeight, setPageHeight] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"learner" | "author" | "undefined">(
    "undefined",
  );
  useEffect(() => {
    const fetchData = async () => {
      const userRole = await getUser();
      setRole(userRole.role);
      if (userRole.role === "learner") {
        // Fetch data from backend for learners
        try {
          const submissionDetails: AssignmentAttemptWithQuestions =
            await getAttempt(assignmentId, id);
          setQuestions(submissionDetails.questions);
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
        } catch (err) {
          console.error("Error fetching submission details:", err);
        } finally {
          setLoading(false);
        }
      } else if (userRole.role === "author") {
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
    id,
    zustandQuestions,
    zustandGrade,
    zustandTotalPointsEarned,
    zustandTotalPoints,
    zustandAssignmentDetails,
  ]);

  const [returnUrl, setReturnUrl] = useState<string>("");
  const { passingGrade } = assignmentDetails || {
    passingGrade: 50,
    id: null,
  };
  const [init, setInit] = useState(false);

  // Initialize tsparticles
  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadFull(engine);
    })
      .then(() => {
        setInit(true);
      })
      .catch((error) => {
        console.error(error);
      });
  }, []);

  // Animation for the crown falling effect
  const crownAnimation = {
    initial: { y: -200, opacity: 0 },
    animate: { y: 60, opacity: 1 },
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
  useEffect(() => {
    setPageHeight(
      Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      ),
    );
  });

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
    return <Loading />;
  }
  const getGradeMessage = (grade: number): string => {
    if (grade >= 80) return "Impressive Mastery! 🌟";
    if (grade >= 70) return "Strong Progress! 🚀";
    if (grade >= 60) return "Solid Effort! 💪";
    if (grade >= 50) return "Steady Improvement! 🔧";
    return "Keep Pushing Forward! 💡";
  };

  const newLocal = getGradeMessage(grade);
  return (
    <div className="relative pt-12 flex flex-col items-center justify-center w-full h-full gap-y-10 bg-gradient-to-b">
      {/* Fireworks Animation for Perfect Score */}
      {init && grade >= 90 && (
        <Particles
          id="fireworks"
          options={fireworksOptions}
          className="absolute inset-0 z-0"
        />
      )}

      {/* Sparkles Animation for Medium Grade */}
      {init && grade >= 60 && grade < 90 && (
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
      <div className="w-full max-w-4xl z-10">
        <div className="flex flex-col items-center text-center gap-y-6">
          {/* Achievement Badge */}
          {Math.round(grade) === 100 && (
            <motion.div
              className="w-24 h-24 mb-4"
              {...crownAnimation} // Apply falling animation
            >
              <Image
                src={Crown as StaticImageData}
                alt="Crown"
                width={96}
                height={96}
              />
            </motion.div>
          )}
          {!Number.isNaN(grade) ? (
            <>
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, type: "spring" }}
                className="w-48 h-48"
              >
                <CircularProgressbarWithChildren
                  value={Math.round(grade)}
                  styles={buildStyles({
                    pathColor: grade >= passingGrade ? "#10B981" : "#EF4444",
                    textColor: "#374151",
                    trailColor: "#D1D5DB",
                    backgroundColor: "#fff",
                  })}
                >
                  <div className="text-[40px] text-gray-500">
                    {Math.round(grade)}%
                  </div>
                </CircularProgressbarWithChildren>
              </motion.div>
              <motion.h1
                className="text-5xl font-extrabold text-gray-800"
                initial={{ opacity: 0, y: -30 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {grade >= 90 ? "Legendary Performance! 🏆" : newLocal}
              </motion.h1>
              <motion.p
                className="text-xl text-gray-600"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {grade >= passingGrade
                  ? "You've successfully completed the assignment."
                  : "Review your answers and try again."}
              </motion.p>
              {/* Performance Metrics */}
              <motion.div
                className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-8 w-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="p-6 bg-white rounded-lg shadow-md text-center">
                  <p className="text-sm text-gray-500">Total Score</p>
                  <p className="text-3xl font-bold text-gray-800">
                    {Math.round(grade)}%
                  </p>
                </div>
                <div className="p-6 bg-white rounded-lg shadow-md text-center">
                  <p className="text-sm text-gray-500">Total Points</p>
                  <p className="text-3xl font-bold text-gray-800">
                    {/*round to 2 decimal places*/}
                    {Math.round(totalPointsEarned)} / {Math.round(totalPoints)}
                  </p>
                </div>
                <div className="p-6 bg-white rounded-lg shadow-md text-center">
                  <p className="text-sm text-gray-500">Passing Grade</p>
                  <p className="text-3xl font-bold text-gray-800">
                    {Math.round(passingGrade * 100) / 100}%
                  </p>
                </div>
              </motion.div>
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
          {/* Action Buttons */}
          <div className="flex flex-wrap justify-center gap-6 mt-10">
            <Link
              href={
                role?.toLowerCase() === "learner"
                  ? `/learner/${assignmentId}`
                  : role?.toLowerCase() === "author"
                    ? `/learner/${assignmentId}/questions?authorMode=true`
                    : "/"
              }
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition flex items-center gap-2 shadow-lg"
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
            </Link>
            {returnUrl && (
              <Link
                href={returnUrl}
                className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-md transition flex items-center gap-2 shadow-lg"
              >
                {/* SVG Icon */}
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <ExitIcon className="w-6 h-6 text-white" />
                </svg>
                Back to Course
              </Link>
            )}
          </div>
        </div>
        {/* Questions Summary */}
        <div className="mt-16">
          {questions.map((question: QuestionStore, index: number) => (
            <Question
              key={question.id}
              number={index + 1}
              question={question}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default SuccessPage;
