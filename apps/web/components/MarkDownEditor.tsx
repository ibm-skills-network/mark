import { getWordCount } from "@/lib/utils";
import dynamic from "next/dynamic";
import { useState, type ComponentPropsWithoutRef } from "react";
import rehypeSanitize from "rehype-sanitize";
import { twMerge } from "tailwind-merge";

interface Props extends ComponentPropsWithoutRef<"section"> {
  value: string;
  setValue: (value: string) => void;
  placeholder?: string;
  textareaClassName?: string;
  maxWords?: number | null;
}
const MdEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
});

function MarkdownEditor(props: Props) {
  const {
    value,
    setValue,
    className,
    textareaClassName,
    maxWords,
    placeholder = "Write your question here...",
  } = props;

  const [wordCount, setWordCount] = useState<number>(
    value?.split(/\s+/).filter(Boolean).length ?? 0
  );

  const handleEditorChange = (text: string) => {
    setWordCount(getWordCount(text));
    if (maxWords && wordCount <= maxWords) {
      setValue(text);
    } else if (!maxWords) {
      setValue(text);
    }
    setValue(text); // Temporary
  };

  return (
    <>
      <MdEditor
        className={twMerge(className, "max-h-96")}
        preview="edit"
        height="100%"
        textareaProps={{
          className: twMerge("placeholder-gray-400", textareaClassName),
          placeholder,
        }}
        visibleDragbar={false}
        value={value}
        onChange={handleEditorChange}
        previewOptions={{
          rehypePlugins: [[rehypeSanitize]],
          className: "whitespace-pre-wrap",
        }}
      >
        {value}
      </MdEditor>
      {/* <ReactMarkdown className="prose">{value}</ReactMarkdown> */}

      {/* Word count display */}
      {maxWords ? (
        <div
          className={`${
            wordCount > maxWords ? "text-red-500" : "text-gray-400"
          } text-sm font-medium leading-tight`}
        >
          Words: {wordCount} / {maxWords}
        </div>
      ) : null}
    </>
  );
}

export default MarkdownEditor;
