// AuthorIntroduction.tsx
"use client";

import MarkdownEditor from "@component/MarkDownEditor";
import React, { useState } from "react";

const AuthorIntroduction = () => {
  const [markdownContent, setMarkdownContent] = useState("");

  const handleMarkdownChange = (newValue) => {
    setMarkdownContent(newValue);
  };

  return (
    <div>
      <MarkdownEditor
        style={{ height: "200px" }}
        value={markdownContent}
        onChange={handleMarkdownChange}
      />
    </div>
  );
};

export default AuthorIntroduction;
