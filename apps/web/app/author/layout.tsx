import Header from "./(components)/Header";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <div className="bg-blue-50">{children}</div>
    </>
  );
}
