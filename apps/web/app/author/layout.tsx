import Header from "./(components)/Header";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <div className="bg-gray-50 flex flex-col flex-1 pt-28 h-screen overflow-auto">
        {children}
      </div>
    </>
  );
}
