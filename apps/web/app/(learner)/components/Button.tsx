import React from "react";

interface Props {
  text: string;
}

function Button(props: Props) {
  const { text } = props;

  return (
    <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
      {text}
    </button>
  );
}

export default Button;
