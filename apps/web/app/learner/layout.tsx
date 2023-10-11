import Header from "./(components)/Header";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <Header />
      <div className="bg-blue-50 flex-1">{children}</div>
    </div>
  );
}
