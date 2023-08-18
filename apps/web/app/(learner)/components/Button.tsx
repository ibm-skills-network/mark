import React from "react";

interface Props {
  text: string;
  onClick?: () => void; // Adding the optional onClick prop
}

function Button(props: Props) {
  const { text, onClick } = props;

  return (
    <button
      onClick={onClick} // Pass the onClick prop to the button element
      className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
    >
      {text}
    </button>
  );
}

export default Button;
