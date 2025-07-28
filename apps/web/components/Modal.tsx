import { ReactNode } from "react";

interface ModalProps {
  onClose: () => void;
  Title: string;
  children: ReactNode;
}

const Modal = ({ onClose, children, Title }: ModalProps) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-[700px] transform transition-transform duration-300 ease-in-out scale-100 h-fit overflow-hidden">
        <div className="modal-header flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">{Title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none"
          >
            &#10005;
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
