"use client";

import type { Question, QuestionStatus, QuestionStore } from "@/config/types";
import { useLearnerStore } from "@/stores/learner";
import MarkdownEditor from "@components/MarkDownEditor";
import { useEffect, useState } from "react";

interface Props {}

function TextQuestion(props: Props) {
  const {} = props;
  const activeQuestionId = useLearnerStore((state) => state.activeQuestionId);

  const [questions, setTextResponse] = useLearnerStore((state) => [
    state.questions,
    state.setTextResponse,
  ]);
  // useEffect(() => {
  //   useLearnerStore.subscribe((state) => {
  //     console.log("state.questions", state.questions);
  //     setText(state.questions[activeQuestionId - 1]?.learnerTextResponse);
  //   });
  // }, [activeQuestionId]);
  // useEffect(() => {
  //   setTextResponse(text);
  // }, []);

  const maxWords = 5;
  console.log(
    "questions[activeQuestionId]?.learnerTextResponse",
    questions[activeQuestionId - 1].learnerTextResponse
  );
  return (
    <MarkdownEditor
      value={questions[activeQuestionId - 1]?.learnerTextResponse || ""}
      // update status
      setValue={(value) => setTextResponse(value)}
      maxWords={maxWords}
    />
  );
}

export default TextQuestion;
