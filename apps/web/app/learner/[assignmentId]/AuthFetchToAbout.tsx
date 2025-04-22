"use client";

import animationData from "@/animations/LoadSN.json";
import { decodeFields } from "@/app/Helpers/decoder";
import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import LoadingPage from "@/app/loading";
import ErrorPage from "@/components/ErrorPage";
import type { Assignment } from "@/config/types";
import { getAssignment, getAttempts } from "@/lib/talkToBackend";
import {
  useAssignmentDetails,
  useLearnerOverviewStore,
  useLearnerStore,
} from "@/stores/learner";
import { useSearchParams } from "next/navigation";
import React, { FC, useEffect, useState } from "react";
import AboutTheAssignment from "../(components)/AboutTheAssignment";

interface AuthFetchToAboutProps {
  assignmentId: number;
  role: "learner" | "author";
  cookie: string;
}

const AuthFetchToAbout: FC<AuthFetchToAboutProps> = ({
  assignmentId,
  role,
  cookie,
}) => {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [listOfAttempts, setListOfAttempts] = useLearnerOverviewStore(
    (state) => [state.listOfAttempts, state.setListOfAttempts],
  );
  const setAssignmentId = useLearnerOverviewStore(
    (state) => state.setAssignmentId,
  );
  const setAssignmentDetails = useAssignmentDetails(
    (state) => state.setAssignmentDetails,
  );
  const userPreferedLanguage = useSearchParams().get("lang") || "en";
  const isQuestionPage = useSearchParams().get("question") === "true";
  const isMounted = true; // Prevent memory leak
  const [error, setError] = useState<{
    code: number;
    message: string;
  } | null>(null);
  const fetchData = async () => {
    setIsLoading(true);
    try {
      if (role === "learner") {
        try {
          // Fetch assignment first to handle errors early
          const assignmentData = await getAssignment(
            assignmentId,
            userPreferedLanguage,
            cookie,
          );

          // Fetch attempts separately, so it's not blocked if assignment fetching fails
          const attemptsData = await getAttempts(assignmentId, cookie);

          if (isMounted && assignmentData) {
            const decodedFields = decodeFields({
              introduction: assignmentData?.introduction,
              instructions: assignmentData?.instructions,
              gradingCriteriaOverview: assignmentData?.gradingCriteriaOverview,
            });

            const decodedAssignment = {
              ...assignmentData,
              ...decodedFields,
            };
            setAssignment(decodedAssignment);
            setAssignmentDetails({
              ...decodedAssignment,
              name: decodedAssignment.name || "Untitled Assignment", // Provide a default name if undefined
            });
            setListOfAttempts(attemptsData);
          }
        } catch (error) {
          console.error("Error loading assignment or attempts:", error);
          setError({
            code: 403,
            message: "You are not authorized to view this page",
          });
          if (isMounted) {
            setAssignment(null);
          }
        }
      } else if (role === "author") {
        const assignmentDetails = getStoredData(
          "assignmentConfig",
          {},
        ) as Assignment;
        if (isMounted) {
          const decodedFields = decodeFields({
            introduction: assignmentDetails?.introduction,
            instructions: assignmentDetails?.instructions,
            gradingCriteriaOverview: assignmentDetails?.gradingCriteriaOverview,
          });

          const decodedAssignment = {
            ...assignmentDetails,
            ...decodedFields,
          };

          setAssignment(decodedAssignment);
        }
      }
    } catch (error) {
      console.error(error);
      if (isMounted) {
        setAssignment(null);
      }
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => {
    setAssignmentId(assignmentId);

    if (!isQuestionPage) {
      void fetchData();
    }
  }, [
    assignmentId,
    cookie,
    role,
    setAssignmentId,
    setListOfAttempts,
    userPreferedLanguage,
  ]);

  if (isLoading) {
    return <LoadingPage animationData={animationData} />;
  }
  if (error) {
    return <ErrorPage error={error.message} statusCode={error.code} />;
  }
  if (!assignment) {
    const errorMessage =
      role === "learner"
        ? "Assignment could not be fetched from server"
        : role === "author"
          ? "Assignment could not be fetched from local storage"
          : "You are not authorized to view this page";
    return <ErrorPage error={errorMessage} />;
  }

  return (
    <>
      <AboutTheAssignment
        assignment={assignment}
        attempts={listOfAttempts}
        role={role}
        assignmentId={assignmentId}
        fetchData={fetchData}
      />
    </>
  );
};

export default AuthFetchToAbout;
