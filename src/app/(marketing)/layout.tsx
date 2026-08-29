export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="light" className="min-h-screen bg-white">
      {children}
    </div>
  );
}
