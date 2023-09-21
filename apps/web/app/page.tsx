"use client";

import { getUser } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { useLearnerStore } from "@/stores/learner";
import { useRouter } from "next/navigation";
// import { redirect } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const router = useRouter();

  const setAuthorActiveAssignmentId = useAuthorStore(
    (state) => state.setActiveAssignmentId
  );

  const setLearnerActiveAssignmentId = useLearnerStore(
    (state) => state.setActiveAssignmentId
  );
  useEffect(() => {
    const asyncFunc = async () => {
      const { role, assignmentId } = await getUser();
      if (role === "author") {
        setAuthorActiveAssignmentId(assignmentId);
        router.push(`/author/${assignmentId}`);
      } else if (role === "learner") {
        setLearnerActiveAssignmentId(assignmentId);
        router.push(`/learner/${assignmentId}`);
      }
    };
    void asyncFunc();
  }, []);
}
