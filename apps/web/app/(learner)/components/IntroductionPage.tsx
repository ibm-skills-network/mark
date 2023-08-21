import React from "react";
import Button from "./Button";
import Title from "./Title";
import InfoLine from "./InfoLine";

interface Props {
  attemptsAllowed?: number;
  timeLimit?: number;
  outOf?: number;
  onBegin?: () => void;
}

function IntroductionPage(props: Props) {
  const { attemptsAllowed = 1, timeLimit = 50, outOf = 40, onBegin } = props;

  return (
    <div className="bg-white p-8 rounded-lg shadow-md introduction-container">
      <div className="flex justify-between items-center mb-4">
        <Title text="Introduction to Project Management" />
        <Button text="Begin the Assignment" onClick={onBegin} />
      </div>
      <div className="flex justify-between text-gray-600">
        <InfoLine text={`Attempts Allowed: ${attemptsAllowed}`} />
        <InfoLine text={`Time limit: ${timeLimit} mins`} />
        <InfoLine text={`Out of: ${outOf}`} />
      </div>
      <Title text="About this Assignment" level="2" />
      <InfoLine text="Welcome to the 'Introduction to Project Management' course! This comprehensive course is designed for individuals interested in starting a career in project management. With the booming field of project management offering numerous opportunities, this course aims to provide you with a solid foundation in project management principles and practices. Throughout this course, you will gain essential knowledge, practical skills, and insights from experienced professionals to embark on your project management journey. Let's get started!" />
      <Title text="Instructions" level="2" />
      <InfoLine text="The quiz consists of both multiple-choice questions and short answer paragraphs. You are required to select the most appropriate answer from the given options. As well as write as much information as possible that relates to the short answer. There will be about 40 Multiple Choice or Matching type questions, and 3 written questions." />
      <Title text="Midterm Assignment Format:" level="3" />
      <InfoLine text="The Exam is open-book, open-notes. For your learning experience, it's best that you do not collaborate with anyone else on the assignment, in person or otherwise. You must use course materials only to complete the exam." />
      <Title text="Materials Covered:" level="3" />
      <InfoLine text="Midterm 1 will cover Weeks 2 - 7, or 'Nature of Science' through 'History of Evolutionary Thought'. Exams cover Lectures and Required materials. I will not directly test from the textbook or Supplemental materials." />
      <Title text="Value of Midterm Exams and Policies:" level="3" />
      <InfoLine text="There are 4 Midterm Exams in this course. We will take the top 3 scores for a total of 40% of your final grade. That means each Midterm that is counted is worth ~13.3% of your final grade. Because we drop 1 Exam, THERE ARE NO MAKEUP EXAMS OFFERED for the first missed exam! If you miss a second exam you will need to discuss the circumstances with Dr. M and documentation may be required." />
    </div>
  );
}

export default IntroductionPage;