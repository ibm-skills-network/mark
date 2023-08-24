// This is the component that we use to add/delete questions for author, it contains two buttons
// which are "add new textbox" and "delete"
"use client";

import React, { useState } from "react";
import TextBox from "./Textbox";

function DynamicTextBoxContainer() {
  const [textBoxes, setTextBoxes] = useState<number[]>([Date.now()]); // Initialize with one textbox
  const textBoxCount = textBoxes.length; //when there's only one text box, you cannot delete it

  const handleAddTextBox = () => {
    setTextBoxes((prevTextBoxes) => [...prevTextBoxes, Date.now()]); // Add a new TextBox by adding a timestamp to the array
  };

  const handleDeleteTextBox = (timestamp: number) => {
    if (textBoxCount === 1) {
      alert("You only have one textbox, so you cannot delete it.");
      return;
    }

    setTextBoxes((prevTextBoxes) =>
      prevTextBoxes.filter((ts) => ts !== timestamp)
    );
  };

  return (
    <div className="mb-[600px]">

      {/* Render each TextBox component */}
      {textBoxes.map((timestamp, index) => (
        <div key={timestamp} className="relative">
          <p className="-mb-[10px]">Question {index + 1}:</p>
          {/* Delete question button */}
          <button className={`absolute 
                              top-0 
                              right-0 
                              text-red-500`
                            }
            onClick={() => handleDeleteTextBox(timestamp)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M14.74 9.00003L14.394 18M9.606 18L9.26 9.00003M19.228 5.79003C19.57 5.84203 19.91 5.89703 20.25 5.95603M19.228 5.79003L18.16 19.673C18.1164 20.2383 17.8611 20.7662 17.445 21.1513C17.029 21.5364 16.4829 21.7502 15.916 21.75H8.084C7.5171 21.7502 6.97102 21.5364 6.55498 21.1513C6.13894 20.7662 5.88359 20.2383 5.84 19.673L4.772 5.79003M19.228 5.79003C18.0739 5.61555 16.9138 5.48313 15.75 5.39303M4.772 5.79003C4.43 5.84103 4.09 5.89603 3.75 5.95503M4.772 5.79003C5.92613 5.61555 7.08623 5.48313 8.25 5.39303M15.75 5.39303V4.47703C15.75 3.29703 14.84 2.31303 13.66 2.27603C12.5536 2.24067 11.4464 2.24067 10.34 2.27603C9.16 2.31303 8.25 3.29803 8.25 4.47703V5.39303M15.75 5.39303C13.2537 5.20011 10.7463 5.20011 8.25 5.39303"
                stroke="#6B7280"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <TextBox />
          
        </div>
      ))}
      <button
        className="bg-blue-700 text-white p-2 rounded-full mb-4 mx-auto justify-center ml-[450px]"
        onClick={handleAddTextBox}
      >
        <svg width="54" height="54" viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g filter="url(#filter0_d_702_15817)">
            <circle cx="27" cy="27" r="25" fill="#1D4ED8" />
            <path
              d="M27 20V26M27 26V32M27 26H33M27 26L21 26"
              stroke="white"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </g>
          <defs>
            <filter
              id="filter0_d_702_15817"
              x="0"
              y="0"
              width="54"
              height="54"
              filterUnits="userSpaceOnUse"
              color-interpolation-filters="sRGB"
            >
              <feFlood flood-opacity="0" result="BackgroundImageFix" />
              <feColorMatrix
                in="SourceAlpha"
                type="matrix"
                values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                result="hardAlpha"
              />
              <feOffset dy="1" />
              <feGaussianBlur stdDeviation="1" />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0"
              />
              <feBlend
                mode="normal"
                in2="BackgroundImageFix"
                result="effect1_dropShadow_702_15817"
              />
              <feBlend
                mode="normal"
                in="SourceGraphic"
                in2="effect1_dropShadow_702_15817"
                result="shape"
              />
            </filter>
          </defs>
        </svg>
      </button>
    </div>
  );
}

export default DynamicTextBoxContainer;
