import React from "react";

interface Props {
  text: string;
  onClick?: () => void;
  disabled?: boolean; // Add a disabled prop
}

function Button(props: Props) {
  const { text, onClick, disabled } = props;

  return (
    <button
      onClick={onClick}
      disabled={disabled} // Apply the disabled prop
      className={`bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`} // Apply styles based on disabled state
    >
      {text}
    </button>
  );
}

export default Button;
