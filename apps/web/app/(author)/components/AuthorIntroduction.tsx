// AuthorIntroduction.tsx
"use client";

import MarkdownEditor from "@components/MarkDownEditor";
import React, { useState } from "react";

const AuthorIntroduction = () => {
  const [markdownContent, setMarkdownContent] = useState("");

  const handleMarkdownChange = (newValue) => {
    setMarkdownContent(newValue);
  };

  return (
    <div
      className={`flex flex-col mt-8 pl-2 rounded-md p-4 bg-white`}
      style={{
        minWidth: "67.5625rem",
        minHeight: "30.5rem",
        maxHeight: "50.5rem",
      }}
    >
      <div className="w-[1082px] h-[104px] bg-gray-50 rounded-tl-[11px] rounded-tr-[11px] border border-gray-300" />
      <div>
        <MarkdownEditor
          style={{ height: "200px" }}
          value={markdownContent}
          onChange={handleMarkdownChange}
        />
      </div>
    </div>
  );
};

export default AuthorIntroduction;
