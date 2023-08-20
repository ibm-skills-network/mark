"use client"
import React, { useState } from 'react';
import TextBox from './textBox'; // Adjust the casing to match the actual file name

function DynamicTextBoxContainer() {
  const [textBoxes, setTextBoxes] = useState<number[]>([]); // Track the number of TextBox components

  const handleAddTextBox = () => {
    setTextBoxes(prevTextBoxes => [...prevTextBoxes, Date.now()]); // Add a new TextBox by adding a timestamp to the array
  };

  const handleDeleteTextBox = (timestamp: number) => {
    setTextBoxes(prevTextBoxes => prevTextBoxes.filter(ts => ts !== timestamp));
  };

  return (
    <div>
      <button className="bg-green-500 text-white p-2 rounded-md mt-4" onClick={handleAddTextBox}>
        Add New TextBox
      </button>

      {/* Render each TextBox component */}
      {textBoxes.map((timestamp) => (
        <div key={timestamp} className="relative">
          {/* Delete question button */}
          <button
            className="absolute top-0 right-0 text-red-500"
            onClick={() => handleDeleteTextBox(timestamp)}
          >
            Delete Question
          </button>
          <TextBox />
        </div>
      ))}
    </div>
  );
}

export default DynamicTextBoxContainer;