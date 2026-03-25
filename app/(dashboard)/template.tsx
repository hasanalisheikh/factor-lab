export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in-0 flex min-w-0 flex-1 flex-col overflow-hidden duration-200 ease-out">
      {children}
    </div>
  );
}
