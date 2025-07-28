import { QuestionAuthorStore } from "@/config/types";

export const processQuestions = (questions: QuestionAuthorStore[]) => {
  return questions.map((question) => {
    const { alreadyInBackend, id, assignmentId, answer, ...dataToSend } =
      question;
    if (dataToSend.type === "TEXT" || dataToSend.type === "URL") {
      dataToSend.choices = null;
    } else if (
      dataToSend.type === "MULTIPLE_CORRECT" ||
      dataToSend.type === "SINGLE_CORRECT"
    ) {
      dataToSend.totalPoints = dataToSend.choices?.reduce(
        (acc, curr) => (curr.points > 0 ? acc + curr.points : acc),
        0,
      );
      dataToSend.scoring = null;
    }
    if (dataToSend.type === "TRUE_FALSE") {
      dataToSend.totalPoints = dataToSend.choices?.reduce(
        (acc, curr) => (curr.points > 0 ? acc + curr.points : acc),
        0,
      );
      if (dataToSend.totalPoints === 0) {
        dataToSend.totalPoints = 1;
      }
      dataToSend.scoring = null;
    }

    dataToSend.numRetries =
      dataToSend.numRetries === -1 ? null : dataToSend.numRetries;

    return {
      ...dataToSend,
      alreadyInBackend,
      id,
      assignmentId,
    };
  });
};
