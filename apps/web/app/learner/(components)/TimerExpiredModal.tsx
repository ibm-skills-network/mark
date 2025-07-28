import { useAssignmentDetails } from "@/stores/learner";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentPropsWithoutRef, type FC } from "react";

type Props = ComponentPropsWithoutRef<"div">;

const TimerExpiredModal: FC<Props> = (props) => {
  const pathname = usePathname();
  const {} = props;

  const activeAssignmentId = useAssignmentDetails(
    (state) => state.assignmentDetails?.id,
  );

  return (
    <div
      className="relative z-10"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-gray-500 bg-opacity-75 transition-opacity fixed inset-0 opacity-100"
        aria-hidden="true"
      />

      <div className="z-10 w-screen overflow-y-auto transition-opacity fixed inset-0 opacity-100">
        <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
          <div className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                <svg
                  className="h-6 w-6 text-red-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
              </div>
              <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                <h3
                  className="text-xl font-semibold leading-6 text-gray-900"
                  id="modal-title"
                >
                  Timer Expired
                </h3>
                <div className="mt-3">
                  <p className="text-base text-gray-500">
                    Your time has expired. Your assignment has been
                    automatically submitted.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-6 sm:ml-10 sm:mt-5 sm:flex sm:pl-4">
              <Link
                href={`${pathname}/learner/${activeAssignmentId}`}
                className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:w-auto"
              >
                Assignment Home
              </Link>
              <Link
                href={"https://author.skills.network/courses"}
                className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:ml-3 sm:mt-0 sm:w-auto"
              >
                Back to course
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimerExpiredModal;
