  // components/admin/CreateAssignmentModal.tsx
  "use client";

  import { useState } from "react";
  import { Dialog, Transition } from "@headlessui/react";
  import { Fragment } from "react";
  import { XMarkIcon } from "@heroicons/react/24/outline";
  import { motion } from "framer-motion";
  import { useAdminStore } from "@/stores/admin";
  import { toast } from "sonner"; // Assuming you're using Sonner for toasts
  import { useCreateAssignmentMutation } from "@/lib/admin"; 
  import { v4 as uuidv4 } from "uuid"; // For generating unique IDs
  interface CreateAssignmentModalProps {
    isOpen: boolean;
    onClose: () => void;
  }

  export default function CreateAssignmentModal({
    isOpen,
    onClose,
  }: CreateAssignmentModalProps) {
    const [step, setStep] = useState(1);
    const [name, setName] = useState("");
    const [introduction, setIntroduction] = useState("");
    const [instructions, setInstructions] = useState("");
    const [timeEstimateMinutes, setTimeEstimateMinutes] = useState("");
    const [isPublished, setIsPublished] = useState(false);
    const [error, setError] = useState("");

    // RTK Query hooks
    const [createAssignment, { isLoading }] = useCreateAssignmentMutation();

    const handleNextStep = () => {
      if (step === 1 && !name.trim()) {
        setError("Please provide a name for the assignment");
        return;
      }
      setError("");
      setStep(step + 1);
    };

    const handlePrevStep = () => {
      setStep(step - 1);
    };

    const handleSubmit = async () => {
      if (!name.trim()) {
        setError("Please provide a name for the assignment");
        setStep(1);
        return;
      }
      // generate a unique ID for assignment group 
      const groupId = `${"group"}-${uuidv4()}`;
      

      try {
        // Create the assignment using the RTK Query mutation
        const result = await createAssignment({
          name,
          published: isPublished.toString(),
          groupId,
          type: "AI_GRADED",
        }).unwrap();
        if (result) {
          toast.success("Assignment created successfully!");
          onClose();
        }
      } catch (err) {
        console.error("Error creating assignment:", err);
        setError("Failed to create assignment. Please try again.");
      }
         
    };

    return (
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog
          as="div"
          className="fixed inset-0 z-50 overflow-y-auto"
          onClose={onClose}
        >
          <div className="min-h-screen px-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black opacity-30" />
            </Transition.Child>

            <span
              className="inline-block h-screen align-middle"
              aria-hidden="true"
            >
              &#8203;
            </span>

            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <div className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
                <Dialog.Title
                  as="div"
                  className="flex justify-between items-center"
                >
                  <h3 className="text-lg font-medium text-gray-900">
                    Create New Assignment
                  </h3>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-500"
                    onClick={onClose}
                    disabled={isLoading}
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </Dialog.Title>

                {/* Progress Steps */}
                <div className="mt-4 mb-6">
                  <div className="flex items-center">
                    {[1, 2].map((item) => (
                      <Fragment key={item}>
                        <div
                          className={`flex items-center justify-center h-8 w-8 rounded-full border-2 ${
                            step >= item
                              ? "bg-violet-600 text-white border-violet-600"
                              : "bg-white text-gray-500 border-gray-300"
                          }`}
                        >
                          {item}
                        </div>
                        {item < 2 && (
                          <div
                            className={`flex-1 h-0.5 mx-2 ${
                              step > item ? "bg-violet-600" : "bg-gray-300"
                            }`}
                          />
                        )}
                      </Fragment>
                    ))}
                  </div>
                  <div className="flex justify-between mt-1 text-xs text-gray-500">
                    <span>Basics</span>
                    <span>Publish</span>
                  </div>
                </div>

                {error && (
                  <div className="mb-4 p-2 bg-red-50 text-red-700 text-sm rounded border border-red-200">
                    {error}
                  </div>
                )}

                <div className="mt-4">
                  {step === 1 && (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                    >
                      <div className="mb-4">
                        <label
                          htmlFor="name"
                          className="block text-sm font-medium text-gray-700 mb-1"
                        >
                          Assignment Name*
                        </label>
                        <input
                          type="text"
                          id="name"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-violet-500 focus:border-violet-500"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="e.g., Introduction to Data Structures"
                          disabled={isLoading}
                        />
                      </div>
                      
                    </motion.div>
                  )}

                  

                  {step === 2 && (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                    >
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Publish Status
                        </label>
                        <div className="flex items-center space-x-4">
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              className="form-radio text-violet-600 focus:ring-violet-500"
                              name="publishStatus"
                              checked={!isPublished}
                              onChange={() => setIsPublished(false)}
                              disabled={isLoading}
                            />
                            <span className="ml-2 text-gray-700">
                              Save as Draft
                            </span>
                          </label>
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              className="form-radio text-violet-600 focus:ring-violet-500"
                              name="publishStatus"
                              checked={isPublished}
                              onChange={() => setIsPublished(true)}
                              disabled={isLoading}
                            />
                            <span className="ml-2 text-gray-700">
                              Publish Now
                            </span>
                          </label>
                        </div>
                      </div>

                      <div className="p-4 bg-gray-50 rounded-md border border-gray-200 mb-4">
                        <h4 className="font-medium text-gray-800 mb-2">
                          Assignment Summary
                        </h4>
                        <div className="text-sm">
                          <p className="mb-1">
                            <span className="font-medium">Name:</span>{" "}
                            {name || "Not provided"}
                          </p>
                          <p className="mb-1">
                            <span className="font-medium">Status:</span>{" "}
                            {isPublished ? "Published" : "Draft"}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div className="mt-6 flex justify-between">
                    {step > 1 ? (
                      <button
                        type="button"
                        onClick={handlePrevStep}
                        className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
                        disabled={isLoading}
                      >
                        Back
                      </button>
                    ) : (
                      <div></div>
                    )}

                    {step < 2 ? (
                      <button
                        type="button"
                        onClick={handleNextStep}
                        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
                        disabled={isLoading}
                      >
                        Next
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isLoading}
                        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                          <>
                            <svg
                              className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              ></circle>
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              ></path>
                            </svg>
                            Creating...
                          </>
                        ) : (
                          "Create Assignment"
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    );
  }
