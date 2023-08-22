// PageComponent.tsx
import React, { useState } from 'react';

function PageComponent({ children }) {
  const [currentPage, setCurrentPage] = useState(1);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  return (
    <div className="bg-white min-h-screen">
      <div className="bg-white flex flex-col min-h-screen">
        <button onClick={() => handlePageChange(1)}>Page 1</button>
        <button onClick={() => handlePageChange(2)}>Page 2</button>
        <button onClick={() => handlePageChange(3)}>Page 3</button>
        <div className="mt-0 flex-grow">{children(currentPage)}</div>
      </div>
    </div>
  );
}

export default PageComponent;
