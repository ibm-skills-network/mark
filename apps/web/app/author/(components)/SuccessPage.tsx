import { type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"section"> {}

function SuccessPage(props: Props) {
  const {} = props;

  return (
    <section className="flex items-center justify-center p-4 bg-yellow-100 border-l-4 border-yellow-500">
      <div className="flex items-center justify-center w-6 h-6 mr-2 bg-yellow-500 rounded-full">
        {/* <ExclamationCircleIcon className="w-4 h-4 text-white" /> */}
      </div>
      <div className="text-sm text-yellow-700">
        This assignment has been submitted. You can no longer make changes.
      </div>
    </section>
  );
}

export default SuccessPage;
