import { type ComponentPropsWithoutRef, type FC } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  earnedPoints: number;
  totalPoints: number;
}

const QuestionScore: FC<Props> = (props) => {
  const { earnedPoints, totalPoints } = props;
  let textColor: string;
  switch (earnedPoints) {
    case totalPoints:
      textColor = "text-green-600";
      break;
    case 0:
      textColor = "text-red-600";
      break;
    default:
      textColor = "text-yellow-600";
  }

  return (
    <div className={textColor}>
      Scored{" "}
      <span className="font-bold">
        {Number.isInteger(earnedPoints)
          ? earnedPoints
          : earnedPoints.toFixed(1)}{" "}
      </span>
      out of {totalPoints} points
    </div>
  );
};

export default QuestionScore;
