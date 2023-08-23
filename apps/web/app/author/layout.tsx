import "../globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Header from "./(components)/Header";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mark",
  description: "Grade your students' work with the power of AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className + " " + "bg-blue-50"}>
        <Header />
        {children}
      </body>
    </html>
  );
}
