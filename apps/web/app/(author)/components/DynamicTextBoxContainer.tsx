"use client"
import React, { useState } from 'react';
import TextBox from './TextBox'; // Import the TextBox component

function DynamicTextBoxContainer() {
  const [textBoxes, setTextBoxes] = useState<number[]>([]); // Track the number of TextBox components

  const handleAddTextBox = () => {
    setTextBoxes(prevTextBoxes => [...prevTextBoxes, Date.now()]); // Add a new TextBox by adding a timestamp to the array
  };

  return (
    <div>
      <button className="bg-green-500 text-white p-2 rounded-md mt-4" onClick={handleAddTextBox}>
        Add New TextBox
      </button>

      {/* Render each TextBox component */}
      {textBoxes.map((timestamp, index) => (
        <TextBox key={timestamp} />
      ))}
    </div>
  );
}

export default DynamicTextBoxContainer;
