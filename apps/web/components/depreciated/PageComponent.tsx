"use client";

import { useState } from "react";

function PageComponent({ children }) {
  const [currentPage, setCurrentPage] = useState(1);

  // const handlePageChange = (page) => {
  //   setCurrentPage(page);
  // };

  return (
    <div className="min-h-screen">
      <div className="flex flex-col min-h-screen">
        <div className="flex items-center justify-between mt-4">
          <button
            // onClick={() => handlePageChange(1)}
            className="text-blue-700 font-bold mr-2"
            style={{ lineHeight: "1.5rem", textAlign: "left" }}
          >
            <div
              className={`w-199.25 h-1 ${
                currentPage === 1 ? "bg-blue-700" : "bg-gray-300"
              }`}
            />
            Step: <span className="text-blue-700 font-normal">1</span>
            <br />
            <span
              className={`font-normal ${
                currentPage !== 1 ? "text-gray-700" : "text-black"
              }`}
            >
              Set Up Intro
            </span>
          </button>

          <button
            // onClick={() => handlePageChange(2)}
            className="text-blue-700 font-bold mr-2"
            style={{ lineHeight: "1.5rem", textAlign: "left" }}
          >
            <div
              className={`w-199.25 h-1 ${
                currentPage === 2 ? "bg-blue-700" : "bg-gray-300"
              }`}
            />
            Step: <span className="text-blue-700 font-normal">2</span>
            <br />
            <span
              className={`font-normal ${
                currentPage !== 2 ? "text-gray-700" : "text-black"
              }`}
            >
              Questions and Rubrics
            </span>
          </button>

          <button
            // onClick={() => handlePageChange(3)}
            className="text-blue-700 font-bold mr-2"
            style={{ lineHeight: "1.5rem", textAlign: "left" }}
          >
            <div
              className={`w-199.25 h-1 ${
                currentPage === 3 ? "bg-blue-700" : "bg-gray-300"
              }`}
            />
            Step: <span className="text-blue-700 font-normal">3</span>
            <br />
            <span
              className={`font-normal ${
                currentPage !== 3 ? "text-gray-700" : "text-black"
              }`}
            >
              Preview
            </span>
          </button>
        </div>
        <div className="mt-0 flex-grow">{children}</div>
      </div>
    </div>
  );
}

export default PageComponent;
