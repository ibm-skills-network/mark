import MarkdownIt from "markdown-it";
import { type ComponentPropsWithoutRef } from "react";
import MdEditor from "react-markdown-editor-lite";
import "react-markdown-editor-lite/lib/index.css";

interface Props extends ComponentPropsWithoutRef<"section"> {
  value: string;
  setValue: (value: string) => void;
  textareaClassName?: string;
}

function MarkdownEditor(props: Props) {
  const { value, setValue, className, style, textareaClassName } = props; // Destructure the style prop
  const mdParser = new MarkdownIt();

  const handleEditorChange = ({ text }: { text: string }) => {
    setValue(text);
  };

  return (
    <MdEditor
      className={
        className + " rounded-md border border-gray-300 overflow-hidden"
      }
      // make height of editor dynamic
      markdownClass={textareaClassName}
      value={value}
      style={{ ...style }}
      renderHTML={(text) => mdParser.render(text)}
      onChange={handleEditorChange}
      view={{ menu: true, md: true, html: false }}
    />
  );
}

export default MarkdownEditor;
