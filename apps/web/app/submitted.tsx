"use client";

import Button from "@learnerComponents/Button";
import { useRouter } from "next/router";

function Submitted() {
  const router = useRouter();

  const handleGoHome = () => {
    // Replace this with your desired route, such as the dashboard or homepage
    router.push("/");
  };

  return (
    <main className="p-24 flex flex-col items-center justify-center h-screen">
      <h1 className="text-2xl font-bold mb-8">Submission Successful!</h1>
      <p className="text-center mb-12">
        We have received your exam. You will receive your results within 3-7
        business days.
      </p>
      <Button onClick={handleGoHome}>Go to Dashboard</Button>
    </main>
  );
}

export default Submitted;
