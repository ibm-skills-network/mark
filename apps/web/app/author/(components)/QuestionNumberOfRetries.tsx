import { ChangeEvent, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  retries: number;
  handleRetryChange: (e: ChangeEvent<HTMLSelectElement>) => void;
}

function Component(props: Props) {
  const { retries, handleRetryChange } = props;

  return (
    <div className="flex flex-col gap-y-1">
      <label className="leading-5 text-gray-800">
        Number of Retries Per Submission
      </label>
      <select
        className="border border-gray-300 rounded-md px-4 py-3"
        name="attempts"
        value={retries ?? -1}
        onChange={handleRetryChange}
      >
        <option value={1}>1</option>
        <option value={2}>2</option>
        <option value={3}>3</option>
        <option value={4}>4</option>
        <option value={5}>5</option>
        <option value={-1}>unlimited</option>
      </select>
    </div>
  );
}

export default Component;
