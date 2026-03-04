export default function DashboardLoading() {
  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* Topbar skeleton */}
      <div className="flex items-center justify-between h-14 px-4 lg:px-6 border-b border-border bg-card/40 shrink-0">
        <div className="h-4 w-24 rounded bg-muted animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded bg-muted animate-pulse" />
          <div className="h-7 w-7 rounded bg-muted animate-pulse" />
          <div className="h-7 w-7 rounded-full bg-muted animate-pulse" />
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 flex flex-col gap-4">
        <div className="h-5 w-32 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-card border border-border animate-pulse" />
          ))}
        </div>
        <div className="h-56 rounded-lg bg-card border border-border animate-pulse" />
        <div className="h-48 rounded-lg bg-card border border-border animate-pulse" />
      </div>
    </div>
  )
}
