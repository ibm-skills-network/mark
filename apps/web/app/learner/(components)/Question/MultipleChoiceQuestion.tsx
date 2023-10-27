import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import { useState } from "react";

interface Props {}

function TrueFalseQuestion(props: Props) {
  const {} = props;
  const activeQuestionNumber = useLearnerStore(
    (state) => state.activeQuestionNumber
  );

  const [questions, addChoice, removeChoice] = useLearnerStore((state) => [
    state.questions,
    state.addChoice,
    state.removeChoice,
  ]);
  const { question, id, choices, learnerChoices } =
    questions[activeQuestionNumber - 1];
  console.log("choices", choices);

  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState<boolean>(false);

  const assignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id
  );

  const handleChoiceClick = (choice: string) => {
    if (!submitted) {
      if (learnerChoices.includes(choice)) {
        removeChoice(choice);
      } else {
        addChoice(choice);
      }
    }
  };

  // const handleSubmit = () => {
  //   const questionResponse: QuestionAttemptRequest = {
  //     learnerAnswerChoice: selectedChoice,
  //   };

  //   // setSubmitted(true);

  //   // if (selectedChoice === true) {
  //   //   setIsCorrect(true);
  //   //   if (updateStatus) {
  //   //     updateStatus("correct");
  //   //   }
  //   // } else {
  //   //   setIsCorrect(false);
  //   //   if (updateStatus) {
  //   //     updateStatus("incorrect");
  //   //   }
  //   // }
  // };

  // const renderFeedbackMessage = () => {
  //   // TODO: make this a component and move it to a separate file
  //   let feedbackText = "";
  //   let bgColor = "";
  //   let borderColor = "";
  //   let textColor = "";
  //   let innerCircleColor = "";

  //   if (submitted) {
  //     if (isCorrect) {
  //       feedbackText = "Correct! Well done.";
  //       bgColor = "bg-emerald-100";
  //       borderColor = "border-emerald-500";
  //       textColor = "text-emerald-800";
  //       innerCircleColor = "bg-emerald-400";
  //     } else {
  //       feedbackText = "Incorrect choice.";
  //       bgColor = "bg-red-100";
  //       borderColor = "border-red-500";
  //       textColor = "text-red-800";
  //       innerCircleColor = "bg-red-400";
  //     }

  //     return (
  //       <div
  //         className={`w-96 h-16 pl-2 pr-2.5 py-0.5 ${bgColor} rounded-lg ${borderColor} justify-center items-center gap-1.5 inline-flex`}
  //       >
  //         <div className="w-2 h-2 relative">
  //           <div
  //             className={`w-1.5 h-1.5 left-[1px] top-[1px] absolute ${innerCircleColor} rounded-full`}
  //           />
  //         </div>
  //         <div
  //           className={`text-center ${textColor} text-base font-medium leading-none`}
  //         >
  //           {feedbackText}
  //         </div>
  //       </div>
  //     );
  //   }

  //   return null;
  // };

  // const buttonStyle = (choice: boolean) => {
  //   if (submitted) {
  //     if (selectedChoice === choice) {
  //       return choice === true
  //         ? "bg-green-100 text-black"
  //         : "bg-red-100 text-black";
  //     }
  //   } else {
  //     if (selectedChoice === choice) {
  //       return "bg-blue-100 text-black";
  //     }
  //   }
  //   return "text-black";
  // };
  if (!choices || choices.length === 0) {
    return null;
  }
  return (
    <>
      {choices.map((choice, index) => {
        // TODO: resolve this when backend is ready for it
        const isChoiceCorrect = false;
        console.log("isChoiceCorrect", isChoiceCorrect);
        console.log("learnerChoices", learnerChoices);
        return (
          <button
            key={index}
            className={`block w-full text-left p-2 mb-2 border rounded ${
              submitted
                ? learnerChoices.includes(choice)
                  ? isChoiceCorrect
                    ? "bg-green-100 text-black"
                    : "bg-red-100 text-black"
                  : "text-black"
                : learnerChoices.includes(choice)
                ? "bg-blue-100 text-black"
                : "text-black"
            }`}
            onClick={() => handleChoiceClick(choice)}
          >
            {choice}
          </button>
        );
      })}
    </>
  );
}

export default TrueFalseQuestion;
