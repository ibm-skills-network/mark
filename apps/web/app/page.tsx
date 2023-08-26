"use client";

import { getUser } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { useLearnerStore } from "@/stores/learner";
import { useRouter } from "next/navigation";
// import { redirect } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const router = useRouter();

  const setAuthorActiveAssignmentID = useAuthorStore(
    (state) => state.setActiveAssignmentID
  );

  const setLearnerActiveAssignmentID = useLearnerStore(
    (state) => state.setActiveAssignmentID
  );
  useEffect(() => {
    const asyncFunc = async () => {
      const { role, assignmentID } = await getUser();
      if (role === "author") {
        setAuthorActiveAssignmentID(assignmentID);
        router.push(`/author/${assignmentID}`);
      } else if (role === "learner") {
        setLearnerActiveAssignmentID(assignmentID);
        router.push(`/learner/${assignmentID}`);
      }
    };
    void asyncFunc();
  }, []);
}
