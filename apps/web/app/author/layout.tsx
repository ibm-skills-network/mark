import Header from "./(components)/Header";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-blue-50 flex flex-col items-center justify-between min-h-screen">
      <Header />
      {children}
    </div>
  );
}
