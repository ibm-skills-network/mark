"use client";

import React, { Fragment, useEffect, useRef, useState } from "react";
import { TypeAnimation } from "react-type-animation";
import velocity from "velocity-animate"; // Import Velocity.js

function QuestionStartPage() {
  const [isVisible, setIsVisible] = useState(true);
  const containerRef = useRef(null);

  const handleGetStarted = () => {
    // Animate the container to slide up and disappear
    velocity(containerRef.current, "fadeOut", {
      duration: 500, // Animation duration in milliseconds
      complete: () => {
        setIsVisible(false); // Set visibility to false after animation
      },
    });
  };

  if (!isVisible) {
    return null; // Return null to make the component disappear
  }

  return (
    <div ref={containerRef} className="bg-transparent">
      {" "}
      {/* Attach ref to the container */}
      <div className="mx-auto max-w-7xl py-24 sm:px-6 sm:py-32 lg:px-8">
        <div className="relative isolate overflow-hidden bg-gray-900 px-6 py-24 text-center shadow-2xl sm:rounded-3xl sm:px-16">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
            <span style={{ fontSize: "1em", fontFamily: "Times New Roman" }}>
              Connect with{" "}
            </span>{" "}
            <span style={{ fontSize: "1em", fontStyle: "italic" }}>Mark</span>
            <br />
            <span style={{ fontFamily: "Times New Roman" }}>
              Your reliable companion for teaching assistance across the board.
            </span>{" "}
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-gray-300">
            Mark is a smart auto-grader based on WatsonX kernal
          </p>
          <TypeAnimation
            className="mx-auto mt-6 max-w-xl leading-8 text-gray-300"
            sequence={[
              // Same substring at the start will only be typed out once, initially
              "Meet Mark: Your WatsonX-backed smart mentor. Elevate learning with Mark intelligent teacher assistant expertise",
              1000, // wait 1s before replacing "Mice" with "Hamsters"
              "Meet Mark: Your WatsonX-backed smart mentor. Elevate learning with Mark intelligent cheat police expertise",
              1000,
              "Meet Mark: Your WatsonX-backed smart mentor. Elevate learning with Mark intelligent auto-grader expertise",
              1000,
              "Meet Mark: Your WatsonX-backed smart mentor. Elevate learning with Mark intelligent mentor expertise",
              1000,
            ]}
            wrapper="span"
            speed={50}
            style={{ fontSize: "1.2em", display: "inline-block" }}
            repeat={Infinity}
          />
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <a
              href="#"
              className="rounded-md bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              onClick={handleGetStarted}
            >
              Get started
            </a>
            <a href="#" className="text-sm font-semibold leading-6 text-white">
              Learn more <span aria-hidden="true">→</span>
            </a>
          </div>
          <svg
            viewBox="0 0 1024 1024"
            className="absolute left-1/2 top-1/2 -z-10 h-[64rem] w-[64rem] -translate-x-1/2 [mask-image:radial-gradient(closest-side,white,transparent)]"
            aria-hidden="true"
          >
            <circle
              cx={512}
              cy={512}
              r={512}
              fill="url(#827591b1-ce8c-4110-b064-7cb85a0b1217)"
              fillOpacity="0.7"
            />
            <defs>
              <radialGradient id="827591b1-ce8c-4110-b064-7cb85a0b1217">
                <stop stopColor="#7775D6" />
                <stop offset={1} stopColor="#E935C1" />
              </radialGradient>
            </defs>
          </svg>
        </div>
      </div>
    </div>
  );
}
export default QuestionStartPage;
