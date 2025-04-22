import { ExclamationTriangleIcon } from "@heroicons/react/24/solid"; // You can use another warning icon if desired
import { type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  description: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  children?: ReactNode;
}

const WarningAlert: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  description,
  confirmText = "Proceed",
  cancelText = "Cancel",
  children,
}: ModalProps) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6 relative animate-fadeIn">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          ✕
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-4">
          <ExclamationTriangleIcon className="h-8 w-8 text-yellow-500" />
          <h2 className="text-xl font-semibold text-gray-900">Warning</h2>
        </div>

        {/* Modal Description */}
        <p className="text-gray-600 mb-6">{description}</p>

        {children}

        {/* Modal Footer with Actions */}
        <div className="flex justify-end gap-4 mt-6">
          <button
            className="px-5 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
            onClick={onClose}
          >
            {cancelText}
          </button>
          <button
            className="px-5 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default WarningAlert;
