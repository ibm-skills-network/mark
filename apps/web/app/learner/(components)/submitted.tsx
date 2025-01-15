"use client";

import Button from "@components/Button";

function Submitted() {
  return (
    <main className="p-24 flex flex-col items-center justify-center h-screen">
      <h1 className="text-2xl font-bold mb-8">Attempt Successful!</h1>
      <p className="text-center mb-12">
        We have received your exam. You will receive your results within 3-7
        business days.
      </p>
      <Button>Go to Dashboard</Button>
    </main>
  );
}

export default Submitted;
