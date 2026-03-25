export default function DashboardLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Topbar skeleton */}
      <div className="border-border bg-card/40 flex h-14 shrink-0 items-center justify-between border-b px-4 lg:px-6">
        <div className="bg-muted h-4 w-24 animate-pulse rounded" />
        <div className="flex items-center gap-2">
          <div className="bg-muted h-7 w-7 animate-pulse rounded" />
          <div className="bg-muted h-7 w-7 animate-pulse rounded" />
          <div className="bg-muted h-7 w-7 animate-pulse rounded-full" />
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6">
        <div className="bg-muted h-5 w-32 animate-pulse rounded" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border-border h-24 animate-pulse rounded-lg border" />
          ))}
        </div>
        <div className="bg-card border-border h-56 animate-pulse rounded-lg border" />
        <div className="bg-card border-border h-48 animate-pulse rounded-lg border" />
      </div>
    </div>
  );
}
