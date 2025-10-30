import Header from "./(components)/Header";
import { BottomVersionBar } from "@/components/version-control/BottomVersionBar";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <div className="bg-gray-50 flex flex-col flex-1 pt-28 pb-16 h-screen overflow-auto">
        {children}
      </div>
      <BottomVersionBar />
    </>
  );
}
