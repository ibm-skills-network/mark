// PageComponent.tsx
import React, { useState } from "react";

function PageComponent({ children }) {
  const [currentPage, setCurrentPage] = useState(1);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  return (
    <div className="bg-white min-h-screen">
      <div className="bg-white flex flex-col min-h-screen">
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => handlePageChange(1)}
            className="text-blue-700 font-bold mr-2"
            style={{ lineHeight: "1.5rem", textAlign: "left" }}
          >
            Step: <span className="font-normal">1</span>
            <br />
            Set Up Intro
          </button>
          <button
            onClick={() => handlePageChange(2)}
            className="text-blue-700 font-bold mr-2"
            style={{ lineHeight: "1.5rem", textAlign: "left" }}
          >
            Step: <span className="font-normal">2</span>
            <br />
            Questions and Rubrics
          </button>
          <button
            onClick={() => handlePageChange(3)}
            className="text-blue-700 font-bold"
            style={{ lineHeight: "1.5rem", textAlign: "left" }}
          >
            Step: <span className="font-normal">3</span>
            <br />
            Preview
          </button>
        </div>
        <div className="mt-0 flex-grow">{children(currentPage)}</div>
      </div>
    </div>
  );
}

export default PageComponent;
