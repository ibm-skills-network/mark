import Header from "./(components)/Header";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <div className="bg-blue-50 flex flex-col flex-1 pt-[7.3125rem] h-screen overflow-auto">
        {children}
      </div>
    </>
  );
}
