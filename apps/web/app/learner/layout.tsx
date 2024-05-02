import { type ReactNode } from "react";
import Header from "./(components)/Header";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="bg-blue-50 flex-1">{children}</div>
    </div>
  );
}
