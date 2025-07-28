import { type ReactNode } from "react";
import Header from "./(components)/Header";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen overflow-hidden">
      <Header />
      {children}
    </div>
  );
}
