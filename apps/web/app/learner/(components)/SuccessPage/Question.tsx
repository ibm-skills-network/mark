import PageWithStickySides from "@/app/components/PageWithStickySides";
import { QuestionStore } from "@/config/types";
import { type ComponentPropsWithoutRef, type FC } from "react";

interface Props extends ComponentPropsWithoutRef<"section"> {
  question: QuestionStore;
}

const Question: FC<Props> = (props) => {
  const { question } = props;

  return (
    <PageWithStickySides
      leftStickySide={<div>left</div>}
      mainContent={<div className="min-h-screen min-w-full">main</div>}
      rightStickySide={<div>right</div>}
    />
    // <div className="flex flex-col items-center justify-center w-full h-full gap-y-6">
    //   {question.toString()}
    // </div>
  );
};

export default Question;

const LeftStickySide = () => {
  return <div>left</div>;
};

const MainContent = () => {
  return <div>main</div>;
};

const RightStickySide = () => {
  return <div>right</div>;
};
