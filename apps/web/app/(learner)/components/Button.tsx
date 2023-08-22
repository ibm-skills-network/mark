import React from "react";

interface Props {
  text: string;
  onClick?: () => void;
  disabled?: boolean;
}

function Button(props: Props) {
  const { text, onClick, disabled } = props;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
    >
      {text}
    </button>
  );
}

export default Button;
