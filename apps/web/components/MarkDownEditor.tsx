import MarkdownIt from "markdown-it";
import { type ComponentPropsWithoutRef } from "react";
import MdEditor from "react-markdown-editor-lite";
import "react-markdown-editor-lite/lib/index.css";
import { twMerge } from "tailwind-merge";

interface Props extends ComponentPropsWithoutRef<"section"> {
  value: string;
  setValue: (value: string) => void;
  textareaClassName?: string;
  maxWords?: number; // Introduced maxWords prop for word limit
}

function MarkdownEditor(props: Props) {
  const { value, setValue, className, style, textareaClassName, maxWords } =
    props;
  const mdParser = new MarkdownIt();

  const wordCount = value.split(/\s+/).filter(Boolean).length; // Count number of words in value

  const handleEditorChange = ({ text }: { text: string }) => {
    const newTextWordCount = text.split(/\s+/).filter(Boolean).length; // Count number of words in new text

    if (maxWords !== undefined && newTextWordCount <= maxWords) {
      setValue(text);
    } else if (maxWords === undefined) {
      setValue(text);
    }
  };

  return (
    <div>
      <MdEditor
        className={
          className + " rounded-md border border-gray-300 overflow-hidden"
        }
        markdownClass={twMerge(
          "focus:ring-0 focus:ring-offset-0",
          textareaClassName
        )}
        value={value}
        style={{ ...style }}
        renderHTML={(text) => mdParser.render(text)}
        onChange={handleEditorChange}
        view={{ menu: true, md: true, html: false }}
      />

      {/* Word count display */}
      <div className="text-gray-400 text-sm font-medium leading-tight">
        Words: {wordCount} / {maxWords}
      </div>
    </div>
  );
}

export default MarkdownEditor;
