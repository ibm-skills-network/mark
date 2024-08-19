"use client";
import Button from "@/components/Button";
import { publishStepOneData } from "@/lib/sendZustandDataToBackend";
import { useAuthorStore } from "@/stores/author";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { type ComponentPropsWithoutRef, type FC } from "react";
interface Props extends ComponentPropsWithoutRef<"nav"> {
  assignmentId: string;
}

export const FooterNavigation: FC<Props> = ({ assignmentId }) => {
  const router = useRouter();
  const [activeAssignmentId] = useAuthorStore((state) => [
    state.activeAssignmentId,
  ]);
  const goToNextStep = async () => {
    router.push(`/author/${activeAssignmentId}/config`);
    await publishStepOneData();
  };
  return (
    <footer className="flex gap-5 justify-end max-w-full text-base font-medium leading-6 text-violet-800 whitespace-nowrap max-md:flex-wrap">
      <Button
        version="secondary"
        RightIcon={ChevronRightIcon}
        onClick={goToNextStep}
      >
        Next
      </Button>
    </footer>
  );
};
