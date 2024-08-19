"use client";
import Button from "@/components/Button";
import { publishStepTwoData } from "@/lib/sendZustandDataToBackend";
import { useAuthorStore } from "@/stores/author";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import type { ComponentPropsWithoutRef, FC } from "react";
interface Props extends ComponentPropsWithoutRef<"nav"> {}

export const FooterNavigation: FC<Props> = () => {
  const router = useRouter();
  const [activeAssignmentId] = useAuthorStore((state) => [
    state.activeAssignmentId,
  ]);

  /**
   * Updates the assignment with the details from here
   * and redirects to the questions page
   * */
  const goToNextStep = async () => {
    router.push(`/author/${activeAssignmentId}/questions`);
    await publishStepTwoData();
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
