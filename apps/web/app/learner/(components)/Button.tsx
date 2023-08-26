import { twMerge } from "tailwind-merge";

interface Props extends React.ComponentPropsWithoutRef<"button"> {}

function Button(props: Props) {
  const { onClick, disabled, children, className } = props;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={twMerge(
        "rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
        className
      )}
    >
      {children}
    </button>
  );
}

export default Button;
