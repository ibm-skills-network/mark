import Tooltip from "@/components/Tooltip";
import { cn } from "@/lib/strings";
import { useLearnerStore } from "@/stores/learner";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import Button from "../../../../components/Button";

interface Props extends React.ComponentPropsWithoutRef<"div"> {
  disabled: boolean;
  message: string;
  label: string;
  href: string;
  className?: string;
}

const BeginTheAssignment: React.FC<Props> = (props) => {
  const { disabled, message, label, href, className } = props;
  const userPreferedLanguage = useLearnerStore(
    (state) => state.userPreferedLanguage,
  );
  const setUserPreferedLanguage = useLearnerStore(
    (state) => state.setUserPreferedLanguage,
  );
  const MoveToQuestionPage = () => {
    if (!disabled) {
      setUserPreferedLanguage(userPreferedLanguage);
      window.location.href = href;
    }
  };

  return (
    <div className={cn(className, "w-full lg:w-auto")}>
      <Tooltip distance={3} content={message}>
        <Button
          className="group flex items-center justify-center w-full sm:w-auto gap-x-2 disabled:opacity-50 text-center bg-violet-500 text-white px-4 py-2 rounded-md"
          disabled={disabled}
          onClick={MoveToQuestionPage}
        >
          {label} the Assignment
          <ChevronRightIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200" />
        </Button>
      </Tooltip>
    </div>
  );
};

export default BeginTheAssignment;
