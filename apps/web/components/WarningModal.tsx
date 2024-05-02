import { Dialog, Transition } from "@headlessui/react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
  Fragment,
  type ComponentPropsWithoutRef,
  type Dispatch,
  type SetStateAction,
} from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  title: string;
  show: boolean;
  setShow: Dispatch<SetStateAction<boolean>>;
  description?: string;
  confirmButtonText?: string;
}

function WarningModal(props: Props) {
  const {
    title,
    show,
    setShow,
    description = "",
    confirmButtonText = "Confirm",
  } = props;

  function leavePage() {
    setShow(false);
    window.close();
  }

  return (
    <Transition.Root show={show} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        // initialFocus={cancelButtonRef}
        onClose={() => setShow(false)}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <ExclamationTriangleIcon
                      className="h-6 w-6 text-red-600"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <Dialog.Title
                      as="h3"
                      className="text-base font-semibold leading-6 text-gray-900"
                    >
                      {title}
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">{description}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 sm:ml-10 sm:mt-4 sm:flex sm:pl-4">
                  <button
                    onClick={leavePage}
                    type="button"
                    className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:w-auto"
                  >
                    {confirmButtonText}
                  </button>
                  <button
                    onClick={() => setShow(false)}
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:ml-3 sm:mt-0 sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
    // <div
    //   className="relative z-10"
    //   aria-labelledby="modal-title"
    //   role="dialog"
    //   aria-modal="true"
    // >
    //   {/* Background backdrop, show/hide based on modal state.

    // Entering: "ease-out duration-300"
    //   From: "opacity-0"
    //   To: "opacity-100"
    // Leaving: "ease-in duration-200"
    //   From: "opacity-100"
    //   To: "opacity-0" */}
    //   <div
    //     className={twMerge(
    //       "bg-gray-500 bg-opacity-75 transition-opacity",
    //       show ? "fixed inset-0 opacity-100" : "hidden opacity-0"
    //     )}
    //     aria-hidden="true"
    //   ></div>

    //   {/* Modal panel, show/hide based on modal state. */}

    //   <div
    //     className={twMerge(
    //       "z-10 w-screen overflow-y-auto transition-opacity",
    //       show ? "fixed inset-0 opacity-100" : "hidden opacity-0"
    //     )}
    //   >
    //     <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
    //       {/* Modal panel, show/hide based on modal state.

    //     Entering: "ease-out duration-300"
    //       From: "opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
    //       To: "opacity-100 translate-y-0 sm:scale-100"
    //     Leaving: "ease-in duration-200"
    //       From: "opacity-100 translate-y-0 sm:scale-100"
    //       To: "opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95" */}

    //       <div className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
    //         <div className="sm:flex sm:items-start">
    //           <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
    //             <svg
    //               className="h-6 w-6 text-red-600"
    //               fill="none"
    //               viewBox="0 0 24 24"
    //               stroke-width="1.5"
    //               stroke="currentColor"
    //               aria-hidden="true"
    //             >
    //               <path
    //                 stroke-linecap="round"
    //                 stroke-linejoin="round"
    //                 d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
    //               />
    //             </svg>
    //           </div>
    //           <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
    //             <h3
    //               className="text-base font-semibold leading-6 text-gray-900"
    //               id="modal-title"
    //             >
    //               {title}
    //             </h3>
    //             <div className="mt-2">
    //               <p className="text-sm text-gray-500">{description}</p>
    //             </div>
    //           </div>
    //         </div>
    //         <div className="mt-5 sm:ml-10 sm:mt-4 sm:flex sm:pl-4">
    //           <button
    //             onClick={leavePage}
    //             type="button"
    //             className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:w-auto"
    //           >
    //             {confirmButtonText}
    //           </button>
    //           <button
    //             onClick={() => setShow(false)}
    //             type="button"
    //             className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:ml-3 sm:mt-0 sm:w-auto"
    //           >
    //             Cancel
    //           </button>
    //         </div>
    //       </div>
    //     </div>
    //   </div>
    // </div>
  );
}

export default WarningModal;
