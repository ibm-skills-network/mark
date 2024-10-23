"use client";

import React, { FC, useEffect, useState } from "react";
import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import { getAssignment, getAttempts } from "@/lib/talkToBackend";
import type { Assignment } from "@/config/types";
import AboutTheAssignment from "../(components)/AboutTheAssignment";
import ErrorPage from "@/components/ErrorPage";
import LoadingPage from "@/app/loading";
import { useLearnerOverviewStore } from "@/stores/learner";

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

  useEffect(() => {
    let isMounted = true; // Prevent memory leak
    setAssignmentId(assignmentId);
    const fetchData = async () => {
      setIsLoading(true);
      try {
        if (role === "learner") {
          const [assignmentData, attemptsData] = await Promise.all([
            getAssignment(assignmentId, cookie),
            getAttempts(assignmentId, cookie),
          ]);
          if (isMounted) {
            setAssignment(assignmentData);
            setListOfAttempts(attemptsData);
          }
        } else if (role === "author") {
          const assignmentDetails = getStoredData(
            "assignmentConfig",
            {},
          ) as Assignment;
          if (isMounted) {
            setAssignment(assignmentDetails);
          }
        }
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setAssignment(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void fetchData();
    return () => {
      isMounted = false;
    };
  }, [assignmentId, cookie, role, setAssignmentId, setListOfAttempts]);

  if (isLoading) {
    return <LoadingPage />;
  }

  if (!assignment) {
    const errorMessage =
      role === "learner"
        ? "Assignment could not be fetched from server"
        : "Assignment could not be fetched from localStorage";
    return <ErrorPage error={errorMessage} />;
  }

  return (
    <AboutTheAssignment
      assignment={assignment}
      attempts={listOfAttempts}
      role={role}
      assignmentId={assignmentId}
    />
  );
};

export default AuthFetchToAbout;
