import React from "react";
import MarkdownIt from "markdown-it";
import MdEditor from "react-markdown-editor-lite";
import "react-markdown-editor-lite/lib/index.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  style?: React.CSSProperties; // Add a style prop
}

function MarkdownEditor(props: Props) {
  const { value, onChange, style } = props; // Destructure the style prop
  const mdParser = new MarkdownIt();

  const handleEditorChange = ({ text }: { text: string }) => {
    onChange(text);
  };

  return (
    <div className="">
      <MdEditor
        value={value}
        style={{ height: "400px", ...style }} // Merge the passed style with the default height
        renderHTML={(text) => mdParser.render(text)}
        onChange={handleEditorChange as any}
      />
    </div>
  );
}

export default MarkdownEditor;